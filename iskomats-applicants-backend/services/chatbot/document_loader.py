import re
from pathlib import Path
from PyPDF2 import PdfReader
from docx import Document as DocxDocument


class DocumentLoader:
    SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".docx"}

    def __init__(self, documents_dir: str):
        self.documents_dir = Path(documents_dir)
        self.documents_dir.mkdir(parents=True, exist_ok=True)

    def load_file(self, file_path: str) -> list[dict]:
        path = Path(file_path)
        ext = path.suffix.lower()

        if ext not in self.SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext}")

        if ext == ".pdf":
            return self._load_pdf(path)
        elif ext == ".docx":
            return self._load_docx(path)
        elif ext in {".txt", ".md"}:
            return self._load_text(path)

    def _load_text(self, path: Path) -> list[dict]:
        content = path.read_text(encoding="utf-8")
        sections = self._split_into_sections(content)
        return [
            {
                "content": section,
                "metadata": {"source": path.name, "type": path.suffix},
            }
            for section in sections
            if section.strip()
        ]

    def _split_into_sections(self, text: str, max_chunk: int = 1000) -> list[str]:
        parts = re.split(r'={3,}', text)
        sections = []
        current_heading = ""
        is_qa_section = False

        for part in parts:
            part = part.strip()
            if not part:
                continue

            lines = part.split("\n")
            first_line = lines[0].strip() if lines else ""

            if len(first_line) < 60 and first_line and not first_line.startswith("•") and not first_line.startswith("-") and not first_line.startswith("Q:"):
                current_heading = first_line
                is_qa_section = "COMMON QUESTIONS" in current_heading.upper()
                rest = "\n".join(lines[1:]).strip()
                if rest:
                    if is_qa_section:
                        qa_chunks = self._split_qa_section(current_heading, rest)
                        sections.extend(qa_chunks)
                    else:
                        chunks = self._chunk_with_heading(current_heading, rest, max_chunk)
                        sections.extend(chunks)
            else:
                if is_qa_section:
                    qa_chunks = self._split_qa_section(current_heading, part)
                    sections.extend(qa_chunks)
                else:
                    chunks = self._chunk_with_heading(current_heading, part, max_chunk)
                    sections.extend(chunks)

        return sections

    def _split_qa_section(self, heading: str, content: str) -> list[str]:
        parts = re.split(r'\n-{4,}\n', content)
        chunks = []
        for part in parts:
            part = part.strip()
            if not part:
                continue
            chunk = f"{heading}\n\n{part}" if heading else part
            chunks.append(chunk)
        return chunks

    def _chunk_with_heading(self, heading: str, content: str, max_chunk: int) -> list[str]:
        if not content.strip():
            return []

        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        chunks = []
        current = f"{heading}\n\n" if heading else ""

        for para in paragraphs:
            test = current + "\n\n" + para if current else para
            if len(test) <= max_chunk:
                current = test
            else:
                if current.strip():
                    chunks.append(current.strip())
                if len(para) > max_chunk:
                    chunks.append(para[:max_chunk])
                else:
                    current = f"{heading}\n\n{para}" if heading else para
                    continue
                current = ""

        if current.strip():
            chunks.append(current.strip())
        return chunks

    def _load_pdf(self, path: Path) -> list[dict]:
        reader = PdfReader(str(path))
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        sections = self._split_into_sections(text)
        return [
            {
                "content": section,
                "metadata": {"source": path.name, "type": "pdf"},
            }
            for section in sections
            if section.strip()
        ]

    def _load_docx(self, path: Path) -> list[dict]:
        doc = DocxDocument(str(path))
        text = "\n".join([para.text for para in doc.paragraphs if para.text])
        sections = self._split_into_sections(text)
        return [
            {
                "content": section,
                "metadata": {"source": path.name, "type": "docx"},
            }
            for section in sections
            if section.strip()
        ]

    def list_documents(self) -> list[str]:
        docs = []
        for ext in self.SUPPORTED_EXTENSIONS:
            docs.extend([f.name for f in self.documents_dir.glob(f"*{ext}")])
        return sorted(docs)
