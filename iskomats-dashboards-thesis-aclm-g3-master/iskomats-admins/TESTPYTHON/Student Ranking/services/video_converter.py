"""
Video format conversion utility.
Converts WebM/other formats to H.264 MP4 for maximum browser compatibility.
"""

import subprocess
import tempfile
import os
import sys
import logging
from datetime import datetime

# Setup logging to both file and console
log_file = os.path.join(os.path.dirname(__file__), '..', 'video_conversion.log')
logging.basicConfig(
    level=logging.DEBUG,
    format='[%(asctime)s] %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

def log_msg(msg):
    """Log message to file and console"""
    print(msg, flush=True)
    logger.info(msg)

def is_ffmpeg_available():
    """Check if ffmpeg is installed on the system."""
    try:
        subprocess.run(['ffmpeg', '-version'], 
                      capture_output=True, 
                      timeout=5,
                      check=True)
        log_msg("[VIDEO CONVERT] ffmpeg is available")
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        log_msg("[VIDEO CONVERT] ffmpeg NOT available")
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
        log_msg("[VIDEO CONVERT] ffmpeg not available, returning original video bytes")
        return video_bytes

    try:
        # Create temp files for input and output
        with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name

        output_path = input_path.replace('.webm', f'.{output_format}')

        try:
            log_msg(f"[VIDEO CONVERT] Starting conversion: {len(video_bytes)} bytes")
            
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

            log_msg(f"[VIDEO CONVERT] Running ffmpeg command")
            # Run ffmpeg
            result = subprocess.run(cmd,
                                  capture_output=True,
                                  timeout=120,
                                  text=True)

            if result.returncode != 0:
                log_msg(f"[VIDEO CONVERT] ffmpeg error: {result.stderr[:300]}")
                return video_bytes  # Return original on error

            # Read converted file
            with open(output_path, 'rb') as f:
                converted_bytes = f.read()

            log_msg(f"[VIDEO CONVERT] Successfully converted {len(video_bytes)} bytes to {len(converted_bytes)} bytes")
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
        log_msg(f"[VIDEO CONVERT] Error converting video: {e}")
        return video_bytes  # Return original on error
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    log_msg("[VIDEO CONVERT] transcode_video_for_streaming called")
    return convert_video_to_mp4(video_bytes)
