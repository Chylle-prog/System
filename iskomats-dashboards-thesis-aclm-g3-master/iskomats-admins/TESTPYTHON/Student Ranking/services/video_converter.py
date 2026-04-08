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
        with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name
        
        output_path = input_path.replace('.webm', f'.{output_format}')
        
        try:
            # Convert WebM to MP4 with H.264 codec
            # -c:v libx264: Use H.264 codec (widely supported)
            # -preset fast: Fast encoding (balance quality/speed)
            # -crf 23: Quality (0-51, lower=better, 23=default)
            # -c:a aac: Use AAC audio codec (widely supported)
            # -movflags +faststart: Enable streaming from start
            cmd = [
                'ffmpeg',
                '-i', input_path,
                '-c:v', 'libx264',        # H.264 codec
                '-preset', 'fast',         # Fast encoding
                '-crf', '23',              # Quality
                '-c:a', 'aac',             # Audio codec
                '-b:a', '128k',            # Audio bitrate
                '-movflags', '+faststart', # Enable streaming
                '-y',                      # Overwrite output
                output_path
            ]
            
            # Run ffmpeg
            result = subprocess.run(cmd, 
                                  capture_output=True, 
                                  timeout=120,
                                  text=True)
            
            if result.returncode != 0:
                print(f"[VIDEO CONVERT] ffmpeg error: {result.stderr}", flush=True)
                return video_bytes  # Return original on error
            
            # Read converted file
            with open(output_path, 'rb') as f:
                converted_bytes = f.read()
            
            print(f"[VIDEO CONVERT] Successfully converted {len(video_bytes)} bytes to {len(converted_bytes)} bytes", flush=True)
            return converted_bytes
            
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
    
    except Exception as e:
        print(f"[VIDEO CONVERT] Error converting video: {e}", flush=True)
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    return convert_video_to_mp4(video_bytes)
