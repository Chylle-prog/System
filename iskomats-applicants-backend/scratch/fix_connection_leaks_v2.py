import re
import os

file_path = r'c:\Users\Chyle\OneDrive\Desktop\System\iskomats-applicants-backend\api_routes.py'

with open(file_path, 'r') as f:
    content = f.read()

# Pattern to find manual conn = get_db() inside try blocks
# and wrap them in 'with get_db() as conn:' while indenting the rest of the block.
# This is complex with regex.

# Alternative: Find functions that use get_db() and wrap their inner logic.

def fix_function_indentation(func_name):
    global content
    # Find function start
    pattern = rf'def {func_name}\(.*?ready_only=False\)?.*?:' # Simplified
    # This is getting too complex.

# Let's try a different approach. 
# We'll look for 'conn = get_db()' and replace it with 'with get_db() as conn:'
# Then we'll indent all subsequent lines in that function that have the same or more indentation.

lines = content.split('\n')
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if 'conn = get_db()' in line and 'with' not in line:
        indent = line[:line.find('conn = get_db()')]
        new_lines.append(f"{indent}with get_db() as conn:")
        
        # Everything until the 'except' or 'return' at the same indent level
        j = i + 1
        while j < len(lines):
            if lines[j].strip() == '':
                new_lines.append('')
                j += 1
                continue
            
            line_indent = len(lines[j]) - len(lines[j].lstrip())
            if line_indent <= len(indent) and lines[j].strip() != '':
                # End of block (likely except or another def)
                break
            
            # Indent and remove manual close
            l = lines[j]
            if 'conn.close()' in l or 'cursor.close()' in l:
                 # Comment out instead of pass to maintain line count if needed, 
                 # but pass is safer for indentation
                 new_lines.append('    ' + indent + 'pass # closed by context')
            else:
                 new_lines.append('    ' + l)
            j += 1
        i = j
    else:
        new_lines.append(line)
        i += 1

with open(file_path + '.fixed', 'w') as f:
    f.write('\n'.join(new_lines))
