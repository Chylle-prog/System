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
        # Create temp files - input can be any format, try common extensions
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tmp') as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name
        
        output_path = input_path.replace('.tmp', f'.{output_format}')
        
        try:
            # Convert to H.264 MP4 with explicit codec/format
            # This works for any input format (WebM, MOV, MKV, etc.)
            cmd = [
                'ffmpeg',
                '-i', input_path,
                '-c:v', 'libx264',        # H.264 video codec
                '-preset', 'ultrafast',   # Fastest encoding (still good quality)
                '-crf', '28',             # Quality (0-51, lower=better, 28=faster)
                '-c:a', 'aac',            # AAC audio codec
                '-b:a', '128k',           # Audio bitrate
                '-movflags', '+faststart',# Enable streaming from start
                '-y',                     # Overwrite output without asking
                output_path
            ]
            
            print(f"[VIDEO CONVERT] Starting conversion with ffmpeg...", flush=True)
            result = subprocess.run(cmd, 
                                  capture_output=True, 
                                  timeout=300,  # Increased timeout to 5 minutes
                                  text=True)
            
            if result.returncode != 0:
                stderr = result.stderr if result.stderr else "No error message"
                print(f"[VIDEO CONVERT] ffmpeg failed with return code {result.returncode}", flush=True)
                print(f"[VIDEO CONVERT] stderr: {stderr[:500]}", flush=True)  # Log first 500 chars of error
                return video_bytes  # Return original on error
            
            # Read converted file
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                with open(output_path, 'rb') as f:
                    converted_bytes = f.read()
                
                print(f"[VIDEO CONVERT] Successfully converted {len(video_bytes)} bytes → {len(converted_bytes)} bytes", flush=True)
                return converted_bytes
            else:
                print(f"[VIDEO CONVERT] Output file not created or empty", flush=True)
                return video_bytes
            
        finally:
            # Cleanup temp files
            for path in [input_path, output_path]:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception as e:
                        print(f"[VIDEO CONVERT] Warning: Could not delete {path}: {e}", flush=True)
    
    except Exception as e:
        print(f"[VIDEO CONVERT] Exception during conversion: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return video_bytes
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    return convert_video_to_mp4(video_bytes)
