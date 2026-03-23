import os
import sys

from psycopg2 import Binary

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.append(PROJECT_DIR)

from project_config import get_db

# Path to your image file
IMAGE_PATH = 'C:/Users/Chyle/OneDrive/Desktop/iskomats-dashboards-thesis-aclm-g3-master_BACKUP/iskomats-admins/TESTPYTHON/Samples/live_capture.jpg'

def update_profile_picture():
    """
    Update the profile picture for applicant_no = 1
    """
    conn = None
    cursor = None
    
    try:
        # Read the image file as binary
        if not os.path.exists(IMAGE_PATH):
            print(f"Error: Image file not found at {IMAGE_PATH}")
            return
        
        with open(IMAGE_PATH, 'rb') as file:
            image_data = file.read()
        
        print(f"Image read successfully. Size: {len(image_data)} bytes")
        
        # Connect to the database
        conn = get_db(cursor_factory=None)
        cursor = conn.cursor()
        
        # Update the database with the image
        update_query = """
            UPDATE applicants 
            SET profile_picture = %s
            WHERE applicant_no = %s
        """
        
        cursor.execute(update_query, (Binary(image_data), 1))
        conn.commit()
        
        print(f"✅ Successfully updated profile picture for applicant_no = 1")
        print(f"   Rows affected: {cursor.rowcount}")
        
    except Exception as e:
        print(f"❌ Database error: {e}")
        if conn:
            conn.rollback()
        
    finally:
        # Close connections
        if cursor:
            cursor.close()
        if conn:
            conn.close()
            print("Database connection closed")

def verify_update():
    """
    Optional: Verify the update by retrieving and saving the image
    """
    conn = None
    cursor = None
    
    try:
        conn = get_db(cursor_factory=None)
        cursor = conn.cursor()
        
        # Retrieve the image
        select_query = """
            SELECT profile_picture 
            FROM applicants 
            WHERE applicant_no = 1
        """
        
        cursor.execute(select_query)
        result = cursor.fetchone()
        
        if result and result[0]:
            # Save the retrieved image to verify
            output_path = 'retrieved_image.jpg'
            with open(output_path, 'wb') as f:
                f.write(result[0])
            
            print(f"✅ Verification: Image retrieved and saved to {output_path}")
            print(f"   Retrieved size: {len(result[0])} bytes")
        else:
            print("⚠️ No image found or image is NULL")
            
    except Exception as e:
        print(f"❌ Verification error: {e}")
        
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

# Run the update
if __name__ == "__main__":
    print("🖼️ Updating profile picture...")
    update_profile_picture()
    
    # Uncomment the next line if you want to verify
    # print("\n🔍 Verifying update...")
    # verify_update()