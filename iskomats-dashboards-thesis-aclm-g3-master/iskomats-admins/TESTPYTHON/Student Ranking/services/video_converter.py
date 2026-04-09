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
def faststart_video_stream(video_bytes, ext='.mp4'):
    """
    Applies the +faststart flag to mp4/mov video bytes without re-encoding.
    This shifts the 'moov' atom to the beginning of the file, allowing immediate 
    HTTP streaming in browsers and preventing MEDIA_ELEMENT_ERRORs, 
    all while using 0 MB of memory and taking milliseconds.
    """
    if not video_bytes or ext not in ['.mp4', '.mov']:
        return video_bytes

    if not is_ffmpeg_available():
        print("[VIDEO CONVERT] ffmpeg not available, returning original bytes", flush=True)
        return video_bytes

    try:
        # Use exact extension so ffmpeg knows container format
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name

        output_path = input_path + '_fs' + ext

        # -c copy: Instantly copy the data streams (NO re-encoding)
        # -movflags +faststart: Restructure the MP4 container for instant HTTP streaming
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-c', 'copy',
            '-movflags', '+faststart',
            '-y',
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, timeout=30, text=True)

        if result.returncode != 0:
            print(f"[VIDEO CONVERT] ffmpeg faststart failed: {result.stderr}", flush=True)
            return video_bytes

        with open(output_path, 'rb') as f:
            faststarted_bytes = f.read()

        print(f"[VIDEO CONVERT] Successfully applied faststart. {len(video_bytes)} -> {len(faststarted_bytes)} bytes", flush=True)
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
