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

    # Check if input is already valid MP4 - if so, return as-is
    if len(video_bytes) > 8:
        # Look for MP4 signature (ftyp at offset 4)
        if video_bytes[4:8] == b'ftyp':
            log_msg(f"[VIDEO CONVERT] Input is already valid MP4 (has ftyp signature), returning as-is")
            return video_bytes

    # Check if ffmpeg is available
    if not is_ffmpeg_available():
        log_msg("[VIDEO CONVERT] ffmpeg not available, returning original video bytes")
        return video_bytes

    try:
        # Create temp files - input can be ANY format
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tmp') as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name

        output_path = input_path.replace('.tmp', f'.{output_format}')

        try:
            log_msg(f"[VIDEO CONVERT] Starting conversion: {len(video_bytes)} bytes")
            
            # Convert to H.264 MP4
            # Use libx264 for video, aac for audio
            cmd = [
                'ffmpeg',
                '-i', input_path,
                '-c:v', 'libx264',        # H.264 codec
                '-preset', 'fast',        # Fast encoding
                '-crf', '23',             # Quality
                '-c:a', 'aac',            # Audio codec
                '-b:a', '128k',           # Audio bitrate
                '-movflags', '+faststart',# Enable streaming
                '-hide_banner',
                '-loglevel', 'warning',
                '-y',                     # Overwrite output
                output_path
            ]

            log_msg(f"[VIDEO CONVERT] Running ffmpeg...")
            result = subprocess.run(cmd,
                                  capture_output=True,
                                  timeout=120,
                                  text=True)

            log_msg(f"[VIDEO CONVERT] FFmpeg return code: {result.returncode}")
            
            # Log FFmpeg output for debugging
            if result.stderr:
                lines = result.stderr.split('\n')
                for line in lines[-5:]:  
                    if line.strip() and ('error' in line.lower() or 'warning' in line.lower() or 'Duration' in line):
                        log_msg(f"[VIDEO CONVERT] FFmpeg: {line[:100]}")

            if result.returncode != 0:
                log_msg(f"[VIDEO CONVERT] Conversion failed, returning original bytes")
                return video_bytes

            # Verify output exists
            if not os.path.exists(output_path):
                log_msg(f"[VIDEO CONVERT] Output file not created, returning original")
                return video_bytes

            output_size = os.path.getsize(output_path)
            log_msg(f"[VIDEO CONVERT] Output file: {output_size} bytes")

            # Read converted file
            with open(output_path, 'rb') as f:
                converted_bytes = f.read()

            actual_size = len(converted_bytes)
            
            # Sanity check: converted file should be reasonable size
            # If it's less than 50% of input for video compression, might be corrupt
            if actual_size < 50000:  # Less than 50KB is suspicious for a video
                log_msg(f"[VIDEO CONVERT] Output suspiciously small ({actual_size} bytes), might be corrupt")
                # Try encoding without audio as fallback
                log_msg(f"[VIDEO CONVERT] Retrying without audio...")
                return _convert_video_no_audio(input_path)

            log_msg(f"[VIDEO CONVERT] Success: {len(video_bytes)} → {actual_size} bytes")
            return converted_bytes

        finally:
            # Cleanup temp files
            for path in [input_path, output_path]:
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except:
                        pass

    except subprocess.TimeoutExpired:
        log_msg(f"[VIDEO CONVERT] Timeout: ffmpeg >120s")
        return video_bytes
    except Exception as e:
        log_msg(f"[VIDEO CONVERT] Error: {type(e).__name__}: {e}")
        return video_bytes


def _convert_video_no_audio(input_path):
    """Fallback: convert video without audio"""
    try:
        log_msg(f"[VIDEO CONVERT] Converting without audio...")
        output_path = input_path.replace('.tmp', '.mp4')
        
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-an',  # No audio
            '-movflags', '+faststart',
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, timeout=120, text=True)
        
        if result.returncode == 0 and os.path.exists(output_path):
            with open(output_path, 'rb') as f:
                data = f.read()
            os.remove(output_path)
            log_msg(f"[VIDEO CONVERT] No-audio conversion: {len(data)} bytes")
            return data
        else:
            log_msg(f"[VIDEO CONVERT] No-audio fallback failed")
            return None
    except Exception as e:
        log_msg(f"[VIDEO CONVERT] No-audio exception: {e}")
        return None
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    log_msg("[VIDEO CONVERT] transcode_video_for_streaming called")
    return convert_video_to_mp4(video_bytes)
