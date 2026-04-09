"""
Video format conversion utility.
Converts WebM/other formats to H.264 MP4 for maximum browser compatibility.
"""

import subprocess
import tempfile
import os
import sys

def is_ffmpeg_available():
    """Check if ffmpeg is installed on the system."""
    try:
        subprocess.run(['ffmpeg', '-version'],
                      capture_output=True,
                      timeout=5,
                      check=True)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        return False
def faststart_video_stream(video_bytes, ext='.mp4'):
    """
    Forcefully transcodes the video to web-safe H.264 (yuv420p) to fix browser 
    MEDIA_ELEMENT_ERROR format bugs (e.g. from HEVC iPhone uploads).
    To prevent 502 Bad Gateway / OOM crashes on Render's 512MB RAM server,
    we heavily constrain the FFmpeg process with limited threads and ultrafast encoding.
    """
    if not video_bytes or ext not in ['.mp4', '.mov']:
        return video_bytes

    if not is_ffmpeg_available():
        print("[VIDEO CONVERT] ffmpeg not available, returning original bytes", flush=True)
        return video_bytes

    try:
        # Use exact extension so ffmpeg correctly reads the container format.
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name

        # Enforce exactly .mp4 out
        output_path = input_path + '_fs.mp4'

        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-vf', 'scale=-2:480',    # Downscale to 480p height max (drastic speedup, massive pixel cut)
            '-r', '24',               # Cap framerate to 24fps
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'ultrafast',   # Drastically lowers memory and CPU spikes
            '-crf', '30',             # Slightly higher compression to save process time
            '-threads', '1',          # Restrict to 1 CPU thread (Critical to prevent OOM)
            '-c:a', 'aac',
            '-b:a', '64k',            # Reduced audio bitrate for faster packaging
            '-movflags', '+faststart', # Crucial: Fixes Chrome HTTP streaming
            '-y',
            output_path
        ]

        # Give a slightly longer timeout since single-threaded transcoding is slower
        result = subprocess.run(cmd, capture_output=True, timeout=180, text=True)

        if result.returncode != 0:
            print(f"[VIDEO CONVERT] ffmpeg transcode failed: {result.stderr}", flush=True)
            return video_bytes

        with open(output_path, 'rb') as f:
            faststarted_bytes = f.read()

        # Safety Check: If it severely truncated the file, transcode probably failed secretly
        if len(faststarted_bytes) < 100000 and len(video_bytes) > len(faststarted_bytes) * 10:
            print(f"[VIDEO CONVERT] Warning: Output suspiciously small ({len(faststarted_bytes)}B). Reverting.", flush=True)
            return video_bytes

        print(f"[VIDEO CONVERT] Successfully transcoded to H.264. {len(video_bytes)} -> {len(faststarted_bytes)} bytes", flush=True)
        return faststarted_bytes

    finally:
        if 'input_path' in locals() and os.path.exists(input_path):
            try: os.remove(input_path)
            except: pass
        if 'output_path' in locals() and os.path.exists(output_path):
            try: os.remove(output_path)
            except: pass
    
    return video_bytes

def transcode_video_for_streaming(video_bytes):
    return faststart_video_stream(video_bytes, '.mp4')
