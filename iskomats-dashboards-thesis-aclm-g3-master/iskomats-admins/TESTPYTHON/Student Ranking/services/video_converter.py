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
        log_msg(f"[VIDEO CONVERT] Empty input, returning empty")
        return video_bytes
    
    log_msg(f"[VIDEO CONVERT] Starting conversion: {len(video_bytes)} bytes input")
    
    # Check if ffmpeg is available
    if not is_ffmpeg_available():
        log_msg("[VIDEO CONVERT] ffmpeg not available, returning original bytes")
        return video_bytes
    
    input_path = None
    output_path = None
    
    try:
        # Create temp input file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tmp') as input_file:
            input_file.write(video_bytes)
            input_path = input_file.name
        
        output_path = input_path.replace('.tmp', f'.{output_format}')
        log_msg(f"[VIDEO CONVERT] Input written to: {input_path}")
        
        # First, try to get input info
        log_msg(f"[VIDEO CONVERT] Probing input file...")
        probe_cmd = ['ffmpeg', '-i', input_path, '-hide_banner']
        probe_result = subprocess.run(probe_cmd, capture_output=True, timeout=30, text=True)
        probe_stderr = probe_result.stderr
        
        # Log first part of probe output
        log_msg(f"[VIDEO CONVERT] Probe output (first 300 chars): {probe_stderr[:300]}")
        
        # Try conversion with minimal encoding
        log_msg(f"[VIDEO CONVERT] Running FFmpeg conversion...")
        cmd = [
            'ffmpeg',
            '-i', input_path,           # Input
            '-c:v', 'libx264',          # H.264 video codec
            '-preset', 'ultrafast',     # Fastest preset
            '-crf', '30',               # Lower quality for speed (0-51)
            '-c:a', 'aac',              # AAC audio
            '-b:a', '96k',              # Lower audio bitrate
            '-movflags', '+faststart',  # Enable progressive download
            '-hide_banner',
            '-loglevel', 'info',
            '-y',                       # Overwrite without asking
            output_path
        ]
        
        log_msg(f"[VIDEO CONVERT] FFmpeg command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, timeout=300, text=True)
        
        log_msg(f"[VIDEO CONVERT] FFmpeg return code: {result.returncode}")
        if result.stderr:
            log_msg(f"[VIDEO CONVERT] FFmpeg stderr (first 500 chars): {result.stderr[:500]}")
        
        # Check if file was created
        if not os.path.exists(output_path):
            log_msg(f"[VIDEO CONVERT] ERROR: Output file not created at {output_path}")
            log_msg(f"[VIDEO CONVERT] Directory exists: {os.path.exists(os.path.dirname(output_path))}")
            return video_bytes
        
        output_size = os.path.getsize(output_path)
        log_msg(f"[VIDEO CONVERT] Output file size: {output_size} bytes")
        
        # Read the output file
        with open(output_path, 'rb') as f:
            output_data = f.read()
        
        actual_size = len(output_data)
        log_msg(f"[VIDEO CONVERT] Actual bytes read: {actual_size}")
        
        # Validate the output is a valid MP4
        if actual_size < 1000:
            log_msg(f"[VIDEO CONVERT] Output file too small ({actual_size} bytes), likely corrupted")
            return video_bytes
        
        # Check for MP4 signature
        if not (output_data[4:8] == b'ftyp' or output_data.find(b'ftyp') > -1):
            log_msg(f"[VIDEO CONVERT] Output missing ftyp header, likely corrupted")
            log_msg(f"[VIDEO CONVERT] First 20 bytes: {output_data[:20]}")
            return video_bytes
        
        compression = (1 - actual_size / len(video_bytes)) * 100
        log_msg(f"[VIDEO CONVERT] SUCCESS: {len(video_bytes)} → {actual_size} bytes ({compression:.1f}% reduction)")
        return output_data
        
    except subprocess.TimeoutExpired:
        log_msg(f"[VIDEO CONVERT] ERROR: FFmpeg timeout (>300s)")
        return video_bytes
    except Exception as e:
        log_msg(f"[VIDEO CONVERT] ERROR: {type(e).__name__}: {str(e)}")
        import traceback
        log_msg(traceback.format_exc())
        return video_bytes
    finally:
        # Cleanup temp files
        for path in [input_path, output_path]:
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                    log_msg(f"[VIDEO CONVERT] Deleted temp file: {path}")
                except Exception as e:
                    log_msg(f"[VIDEO CONVERT] Failed to delete {path}: {e}")
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    log_msg("[VIDEO CONVERT] transcode_video_for_streaming called")
    return convert_video_to_mp4(video_bytes)
