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
            # First, probe the input to see what streams are available
            print(f"[VIDEO CONVERT] Input: {len(video_bytes)} bytes, probing format...", flush=True)
            
            probe_cmd = ['ffmpeg', '-i', input_path, '-hide_banner']
            probe_result = subprocess.run(probe_cmd, capture_output=True, timeout=30, text=True)
            probe_info = probe_result.stderr  # ffmpeg puts format info in stderr
            
            # Log first 500 chars of probe output to see what we're working with
            print(f"[VIDEO CONVERT] Probe output: {probe_info[:500]}", flush=True)
            
            # Check for video stream
            has_video = 'Video:' in probe_info
            has_audio = 'Audio:' in probe_info
            print(f"[VIDEO CONVERT] Has video stream: {has_video}, Has audio stream: {has_audio}", flush=True)
            
            # Now convert with explicit stream handling
            cmd = [
                'ffmpeg',
                '-i', input_path,
                '-c:v', 'libx264',           # H.264 video codec
                '-preset', 'fast',           # Fast encoding
                '-crf', '25',                # Quality (higher = faster)
                '-c:a', 'aac',               # AAC audio codec
                '-b:a', '128k',              # Audio bitrate
                '-movflags', '+faststart',   # Enable streaming
                '-loglevel', 'warning',      # Log warnings (not just errors)
                '-y',                        # Overwrite output
                output_path
            ]
            
            print(f"[VIDEO CONVERT] Running ffmpeg conversion...", flush=True)
            result = subprocess.run(cmd, 
                                  capture_output=True, 
                                  timeout=300,
                                  text=True)
            
            print(f"[VIDEO CONVERT] FFmpeg return code: {result.returncode}", flush=True)
            if result.stderr:
                print(f"[VIDEO CONVERT] FFmpeg stderr (first 400 chars): {result.stderr[:400]}", flush=True)
            
            if result.returncode != 0:
                print(f"[VIDEO CONVERT] Conversion failed, returning original bytes", flush=True)
                return video_bytes
            
            # Verify output exists and get size
            if not os.path.exists(output_path):
                print(f"[VIDEO CONVERT] Output file not created, returning original", flush=True)
                return video_bytes
            
            output_size = os.path.getsize(output_path)
            print(f"[VIDEO CONVERT] Output file created: {output_size} bytes", flush=True)
            
            # For a valid MP4, we need:
            # 1. File size > 1KB (minimum viable video)
            # 2. Valid MP4 header (ftyp at start)
            # 3. moov atom present (video metadata)
            
            with open(output_path, 'rb') as f:
                header = f.read(4)
                f.seek(0)
                full_data = f.read()
            
            has_ftyp = header == b'\x00\x00\x00\x20ftyp' or b'ftyp' in full_data[:16]
            has_moov = b'moov' in full_data
            
            print(f"[VIDEO CONVERT] Valid ftyp header: {has_ftyp}, Has moov: {has_moov}, Size: {output_size}", flush=True)
            
            # If file is very small or missing required atoms, it's probably corrupted
            if output_size < 10000 or not has_moov:
                print(f"[VIDEO CONVERT] Output invalid/incomplete (size {output_size}, moov: {has_moov}), returning original", flush=True)
                return video_bytes
            
            # File looks valid, return it
            print(f"[VIDEO CONVERT] SUCCESS: Converted {len(video_bytes)} → {output_size} bytes ({100*(1-output_size/len(video_bytes)):.1f}% reduction)", flush=True)
            return full_data
            
        finally:
            # Cleanup temp files
            for path in [input_path, output_path]:
                try:
                    if os.path.exists(path):
                        os.remove(path)
                except Exception as e:
                    print(f"[VIDEO CONVERT] Warning: Could not delete {path}: {e}", flush=True)
    
    except subprocess.TimeoutExpired:
        print(f"[VIDEO CONVERT] Conversion TIMEOUT (>300s)", flush=True)
        return video_bytes
    except Exception as e:
        print(f"[VIDEO CONVERT] EXCEPTION: {type(e).__name__}: {e}", flush=True)
        return video_bytes
        return video_bytes  # Return original on error

def transcode_video_for_streaming(video_bytes):
    """
    Transcode video for smooth streaming with multiple quality levels.
    For now, just ensures H.264 MP4 format for compatibility.
    """
    return convert_video_to_mp4(video_bytes)
