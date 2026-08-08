import re

filepath = r'services/ocr_utils.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Detect line ending
if '\r\n' in content[:200]:
    eol = '\r\n'
else:
    eol = '\n'
print(f"Detected EOL: {repr(eol)}")

# Use simple find-replace with the known unique start+end markers
start_marker = "    name_anchor_patterns = ["
# Look for the end of the block (the "break" after "candidate_name = m.group(1).strip()")
end_marker_v1 = "            candidate_name = m.group(1).strip()\r\n            break\r\n"
end_marker_v2 = "            candidate_name = m.group(1).strip()\n            break\n"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker_v1, start_idx)
end_marker_used = end_marker_v1
if end_idx < 0:
    end_idx = content.find(end_marker_v2, start_idx)
    end_marker_used = end_marker_v2

print(f"start_idx={start_idx}, end_idx={end_idx}")

if start_idx >= 0 and end_idx >= 0:
    end_idx += len(end_marker_used)
    replacement = (
        "    name_anchor_patterns = [" + eol
        + "        r'(?:certify|certifies)\\s+that\\s+([A-Za-z][A-Za-z\\s,\\.\\-]{2,60}?)(?=\\s+\\d+\\s*(?:years?|yr|yo|taong)|\\s+of\\s+legal\\s+age|\\s+(?:single|married|widow|widower|separated|divorced|filipino|pilipino|citizen|is\\s+a\\s+resident|is\\s+a\\s+bonafide|a\\s+resident|a\\s+bonafide|residing|resident|registered)|\\n|$)'," + eol
        + "        r'(?:this\\s+is\\s+to\\s+certify\\s+that)\\s+([A-Za-z][A-Za-z\\s,\\.\\-]{2,60}?)(?=\\s+\\d+\\s*(?:years?|yr|yo)|\\s+of\\s+legal\\s+age|\\s+(?:single|married|widow|separated|filipino|is|a|the|resident|bonafide|residing)|\\n|$)'," + eol
        + "        r'(?:pinatutunayan|patunay|katibayan)\\s+na\\s+si\\s+([A-Za-z\\s,\\.\\-]+?)(?=\\s+(?:ay|na|taga|mamamayan|residente)|\\n|$)'," + eol
        + "        r'pangalan\\s*[:\\-]\\s*([A-Za-z\\s,\\.\\-]+)'," + eol
        + "        r'name\\s*[:\\-]\\s*([A-Za-z\\s,\\.\\-]+)'" + eol
        + "    ]" + eol
        + eol
        + "    for p in name_anchor_patterns:" + eol
        + "        m = re.search(p, clean_text, re.IGNORECASE)" + eol
        + "        if m:" + eol
        + "            raw_name = m.group(1).strip()" + eol
        + "            # Strip trailing age / civil status / citizenship noise that may have slipped in" + eol
        + "            raw_name = re.sub(r'\\s*(?:\\d+\\s*years?\\s*of\\s*age|of\\s*legal\\s*age|\\d+\\s*(?:years?|yr))\\s*.*$', '', raw_name, flags=re.IGNORECASE).strip()" + eol
        + "            raw_name = re.sub(r'\\s*(?:single|married|widow(?:er)?|separated|divorced|filipino(?:\\s*citizen)?|pilipino(?:\\s*citizen)?)\\s*.*$', '', raw_name, flags=re.IGNORECASE).strip()" + eol
        + "            # Must have at least 2 words and valid name content" + eol
        + "            if len(raw_name) >= 3 and ' ' in raw_name and not re.search(r'certify|certificate|barangay|office|republic|philippines|punong|that$', raw_name, re.IGNORECASE):" + eol
        + "                candidate_name = raw_name" + eol
        + "                break" + eol
    )
    new_content = content[:start_idx] + replacement + content[end_idx:]
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("SUCCESS: extract_semantic_anchors_from_indigency patched!")
    # Verify
    with open(filepath, 'r', encoding='utf-8') as f:
        verify = f.read()
    if "raw_name = m.group(1).strip()" in verify:
        print("VERIFIED: new code found in file.")
    else:
        print("WARNING: new code NOT found in verify read!")
else:
    # Show what's in the block area
    if start_idx >= 0:
        ctx = content[start_idx:start_idx+600]
        print("Context:", repr(ctx))
