import re
import os

file_path = r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-applicants-backend\api_routes.py'

with open(file_path, 'r') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if 'conn = get_db()' in line and 'with' not in line:
        # Found a manual connection.
        # Check if it's already inside a try block.
        indent = line[:line.find('conn = get_db()')]
        
        # We want to replace it with 'with get_db() as conn:'
        # and indent everything until the end of the try block or function.
        new_lines.append(f"{indent}with get_db() as conn:\n")
        
        # Find where this block ends. 
        # Usually it's followed by cursor = conn.cursor()
        # We'll indent everything until we find a return or the end of the try/except.
        
        j = i + 1
        while j < len(lines):
            next_line = lines[j]
            # If we find conn.close() or cursor.close(), we just remove them or comment them.
            if 'conn.close()' in next_line:
                new_lines.append(next_line.replace('conn.close()', 'pass # conn closed by context'))
            elif 'cursor.close()' in next_line:
                new_lines.append(next_line.replace('cursor.close()', 'pass # cursor closed'))
            elif next_line.strip() == '' or next_line.startswith(indent + '    ') or next_line.startswith(indent + '\t'):
                 new_lines.append('    ' + next_line)
            else:
                # End of block
                break
            j += 1
        i = j
    else:
        new_lines.append(line)
        i += 1

with open(file_path + '.new', 'w') as f:
    f.writelines(new_lines)

print("Done. Check api_routes.py.new")
