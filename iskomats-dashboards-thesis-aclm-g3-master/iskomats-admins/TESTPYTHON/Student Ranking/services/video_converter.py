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

def convert_video_to_mp4(video_bytes, output_format='mp4'):
    """
    Convert video bytes to H.264 MP4 format for maximum browser compatibility.
    
    Args:
        video_bytes: Raw video file bytes
        output_format: Output format (default: 'mp4')
    
    Returns:
        bytes: Converted video data, or original bytes if conversion fails
    """
    if not video_bytes:
        return video_bytes

    # Check if ffmpeg is available
    if not is_ffmpeg_available():
        print("[VIDEO CONVERT] ffmpeg not available, returning original video bytes", flush=True)
        return video_bytes

    try:
        # Create temp files for input and output
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tmp') as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name

        output_path = input_path.replace('.tmp', f'.{output_format}')

        try:
            # First attempt: with audio
            print(f"[VIDEO CONVERT] Converting {len(video_bytes)} bytes with audio...", flush=True)
            
            cmd = [
                'ffmpeg',
                '-i', input_path,
                '-c:v', 'libx264',        # H.264 codec
                '-preset', 'fast',        # Fast encoding
                '-crf', '23',             # Quality
                '-c:a', 'aac',            # Audio codec
                '-b:a', '128k',           # Audio bitrate
                '-movflags', '+faststart',# Enable streaming
                '-y',                     # Overwrite output
                output_path
            ]

            result = subprocess.run(cmd,
                                  capture_output=True,
                                  timeout=120,
                                  text=True)

            if result.returncode == 0 and os.path.exists(output_path):
                with open(output_path, 'rb') as f:
                    converted_bytes = f.read()
                size = len(converted_bytes)
                
                # Check if output looks valid (at least 100 KB for a video)
                if size >= 100000:
                    print(f"[VIDEO CONVERT] Success with audio: {len(video_bytes)} → {size} bytes", flush=True)
                    return converted_bytes
                else:
                    print(f"[VIDEO CONVERT] Audio encoding produced suspiciously small file ({size} bytes), trying without audio...", flush=True)
                    if os.path.exists(output_path):
                        os.remove(output_path)
            
            # Fallback: try without audio
            print(f"[VIDEO CONVERT] Retrying without audio...", flush=True)
            cmd_no_audio = [
                'ffmpeg',
                '-i', input_path,
                '-c:v', 'libx264',        # H.264 codec
                '-preset', 'fast',
                '-crf', '23',
                '-an',                    # NO AUDIO
                '-movflags', '+faststart',
                '-y',
                output_path
            ]

            result = subprocess.run(cmd_no_audio,
                                  capture_output=True,
                                  timeout=120,
                                  text=True)

            if result.returncode == 0 and os.path.exists(output_path):
                with open(output_path, 'rb') as f:
                    converted_bytes = f.read()
                
                size = len(converted_bytes)
                if size >= 50000:  # At least 50 KB
                    print(f"[VIDEO CONVERT] Success without audio: {len(video_bytes)} → {size} bytes", flush=True)
                    return converted_bytes

            # If both attempts failed, return original
            print(f"[VIDEO CONVERT] Both conversions failed, returning original bytes", flush=True)
            return video_bytes

        finally:
            # Cleanup temp files
            if os.path.exists(input_path):
                try:
                    os.remove(input_path)
                except:
                    pass
            if os.path.exists(output_path):
                try:
                    os.remove(output_path)
                except:
                    pass

    except subprocess.TimeoutExpired:
        print(f"[VIDEO CONVERT] Timeout (>120s), returning original", flush=True)
        return video_bytes
    except Exception as e:
        print(f"[VIDEO CONVERT] Error: {e}", flush=True)
        return video_bytes

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    return convert_video_to_mp4(video_bytes)
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    log_msg("[VIDEO CONVERT] transcode_video_for_streaming called")
    return convert_video_to_mp4(video_bytes)
