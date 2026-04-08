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
            # First attempt: normal conversion with good quality settings
            print(f"[VIDEO CONVERT] Starting conversion ({len(video_bytes)} bytes input)...", flush=True)
            
            cmd = [
                'ffmpeg',
                '-i', input_path,
                '-c:v', 'libx264',        # H.264 video codec
                '-preset', 'medium',      # Balance speed/quality
                '-crf', '22',             # Quality (0-51, lower=better)
                '-c:a', 'aac',            # AAC audio codec  
                '-b:a', '128k',           # Audio bitrate
                '-movflags', '+faststart',# Enable streaming from start
                '-loglevel', 'error',     # Only log errors from ffmpeg
                '-y',                     # Overwrite output without asking
                output_path
            ]
            
            result = subprocess.run(cmd, 
                                  capture_output=True, 
                                  timeout=300,
                                  text=True)
            
            if result.returncode != 0:
                print(f"[VIDEO CONVERT] Conversion failed (return code: {result.returncode})", flush=True)
                if result.stderr:
                    print(f"[VIDEO CONVERT] Error: {result.stderr[:300]}", flush=True)
                return video_bytes
            
            # Verify output exists
            if not os.path.exists(output_path):
                print(f"[VIDEO CONVERT] Output file was not created", flush=True)
                return video_bytes
            
            output_size = os.path.getsize(output_path)
            print(f"[VIDEO CONVERT] Output file size: {output_size} bytes", flush=True)
            
            # Check if output is valid MP4 (should start with ftyp signature or have reasonable size)
            with open(output_path, 'rb') as f:
                header = f.read(12)
            
            # MP4 files should have 'ftyp' or 'mdat' in the first 4-12 bytes
            has_valid_header = (b'ftyp' in header or b'mdat' in header or b'moov' in header)
            
            print(f"[VIDEO CONVERT] Header valid: {has_valid_header}, {repr(header[:12])}", flush=True)
            
            # Minimum MP4 file size is ~500 bytes (just moov atom)
            if output_size < 500 or not has_valid_header:
                print(f"[VIDEO CONVERT] Output appears corrupted or incomplete, trying fallback...", flush=True)
                
                # Fallback: copy original file without conversion
                # This is better than returning incomplete converted data
                print(f"[VIDEO CONVERT] Using original video bytes instead", flush=True)
                return video_bytes
            
            # File looks good, read it
            with open(output_path, 'rb') as f:
                converted_bytes = f.read()
            
            compression_ratio = (1 - len(converted_bytes) / len(video_bytes)) * 100
            print(f"[VIDEO CONVERT] Success: {len(video_bytes)} → {len(converted_bytes)} bytes ({compression_ratio:.1f}% reduction)", flush=True)
            return converted_bytes
            
        finally:
            # Cleanup temp files
            for path in [input_path, output_path]:
                try:
                    if os.path.exists(path):
                        os.remove(path)
                except Exception as e:
                    print(f"[VIDEO CONVERT] Warning: Could not delete {path}: {e}", flush=True)
    
    except subprocess.TimeoutExpired:
        print(f"[VIDEO CONVERT] Conversion timed out (>300s)", flush=True)
        return video_bytes
    except Exception as e:
        print(f"[VIDEO CONVERT] Exception: {type(e).__name__}: {e}", flush=True)
        return video_bytes
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    return convert_video_to_mp4(video_bytes)
