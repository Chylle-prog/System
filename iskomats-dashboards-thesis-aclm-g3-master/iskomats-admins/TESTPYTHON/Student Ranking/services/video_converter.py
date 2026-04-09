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
    Makes video web-safe for browser streaming.
    
    Strategy (fast path first):
    1. Try stream copy with +faststart (near-instant, works for H.264 MP4/MOV)
    2. Fall back to full H.264 re-encode only if stream copy fails (needed for HEVC iPhone videos)
    
    To prevent 502 Bad Gateway / OOM crashes on Render's 512MB RAM server,
    the re-encode fallback is heavily constrained with limited threads and ultrafast encoding.
    """
    if not video_bytes or ext not in ['.mp4', '.mov']:
        return video_bytes

    if not is_ffmpeg_available():
        print("[VIDEO CONVERT] ffmpeg not available, returning original bytes", flush=True)
        return video_bytes

    input_path = None
    output_path = None
    try:
        # Use exact extension so ffmpeg correctly reads the container format.
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name

        output_path = input_path + '_fs.mp4'

        # --- FAST PATH: Stream copy (no re-encode) ---
        # Works for H.264 MP4/MOV (most Android phones, older iPhones).
        # Takes < 2 seconds regardless of video length.
        cmd_copy = [
            'ffmpeg',
            '-i', input_path,
            '-c', 'copy',
            '-movflags', '+faststart',
            '-y',
            output_path
        ]
        result_copy = subprocess.run(cmd_copy, capture_output=True, timeout=30, text=True)

        if result_copy.returncode == 0:
            with open(output_path, 'rb') as f:
                copied_bytes = f.read()
            if len(copied_bytes) > 10000:
                print(f"[VIDEO CONVERT] Fast stream copy succeeded. {len(video_bytes)} -> {len(copied_bytes)} bytes", flush=True)
                return copied_bytes

        # --- SLOW PATH: Full H.264 re-encode (HEVC/H.265 iPhone videos, etc.) ---
        print(f"[VIDEO CONVERT] Stream copy failed (likely HEVC), falling back to H.264 transcode...", flush=True)
        cmd_encode = [
            'ffmpeg',
            '-i', input_path,
            '-vf', 'scale=-2:480',    # Downscale to 480p (drastic speedup)
            '-r', '24',               # Cap framerate to 24fps
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'ultrafast',   # Lowest memory/CPU usage
            '-crf', '30',
            '-threads', '1',          # Restrict to 1 CPU thread (prevents OOM on Render)
            '-c:a', 'aac',
            '-b:a', '64k',
            '-movflags', '+faststart',
            '-y',
            output_path
        ]
        result_encode = subprocess.run(cmd_encode, capture_output=True, timeout=180, text=True)

        if result_encode.returncode != 0:
            print(f"[VIDEO CONVERT] ffmpeg transcode failed: {result_encode.stderr}", flush=True)
            return video_bytes

        with open(output_path, 'rb') as f:
            transcoded_bytes = f.read()

        # Safety check: if severely truncated, transcode probably failed silently
        if len(transcoded_bytes) < 100000 and len(video_bytes) > len(transcoded_bytes) * 10:
            print(f"[VIDEO CONVERT] Warning: Output suspiciously small ({len(transcoded_bytes)}B). Reverting.", flush=True)
            return video_bytes

        print(f"[VIDEO CONVERT] Successfully transcoded to H.264. {len(video_bytes)} -> {len(transcoded_bytes)} bytes", flush=True)
        return transcoded_bytes

    finally:
        if input_path and os.path.exists(input_path):
            try: os.remove(input_path)
            except: pass
        if output_path and os.path.exists(output_path):
            try: os.remove(output_path)
            except: pass

    return video_bytes

def transcode_video_for_streaming(video_bytes):
    return faststart_video_stream(video_bytes, '.mp4')
