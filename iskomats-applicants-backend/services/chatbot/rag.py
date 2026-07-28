import os
import re
import logging
from pathlib import Path
from services.chatbot.document_loader import DocumentLoader

logger = logging.getLogger(__name__)

STOP_WORDS = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could',
    'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has',
    'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if',
    'in', 'into', 'is', 'it', 'its', 'itself', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'of', 'off',
    'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she',
    'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
    'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
    'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you',
    'your', 'yours', 'yourself', 'yourselves'
}

def tokenize(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r'\w+', text or "") if len(w) >= 2 and w.lower() not in STOP_WORDS]

class RAGPipeline:
    def __init__(
        self,
        document_loader: DocumentLoader,
        persist_dir: str,
    ):
        self.loader = document_loader
        self.persist_dir = persist_dir
        self.chunks = []
        self.chroma_collection = None
        
        # Load all document chunks into ultra-fast in-memory cache
        self.reload_memory_cache()

        try:
            import chromadb
            from chromadb.config import Settings
            self.client = chromadb.PersistentClient(
                path=persist_dir,
                settings=Settings(anonymized_telemetry=False),
            )
            self.chroma_collection = self.client.get_or_create_collection(
                name="documents",
                metadata={"hnsw:space": "cosine"},
            )
        except Exception as e:
            logger.warning(f"ChromaDB init note: {e}")

    def reload_memory_cache(self):
        try:
            new_chunks = []
            if self.loader and self.loader.documents_dir.exists():
                for p in self.loader.documents_dir.glob("*"):
                    if p.suffix.lower() in self.loader.SUPPORTED_EXTENSIONS:
                        try:
                            file_chunks = self.loader.load_file(str(p))
                            for i, c in enumerate(file_chunks):
                                new_chunks.append({
                                    "id": f"{p.name}_{i}",
                                    "content": c["content"],
                                    "source": c["metadata"].get("source", p.name),
                                    "tokens": set(tokenize(c["content"]))
                                })
                        except Exception as e:
                            logger.warning(f"Error loading {p}: {e}")
            self.chunks = new_chunks
            logger.info(f"Loaded {len(self.chunks)} document chunks into sub-millisecond memory cache.")
        except Exception as e:
            logger.error(f"Failed to reload memory cache: {e}")

    def add_document(self, filename: str, file_path: str) -> int:
        chunks = self.loader.load_file(file_path)
        if not chunks:
            return 0

        for i, chunk in enumerate(chunks):
            self.chunks.append({
                "id": f"{filename}_{i}",
                "content": chunk["content"],
                "source": chunk["metadata"].get("source", filename),
                "tokens": set(tokenize(chunk["content"]))
            })

        if self.chroma_collection:
            try:
                ids = [f"{filename}_{i}" for i in range(len(chunks))]
                documents = [c["content"] for c in chunks]
                metadatas = [c["metadata"] for c in chunks]
                self.chroma_collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
            except Exception as e:
                logger.warning(f"ChromaDB upsert note: {e}")

        return len(chunks)

    def search(self, query: str, n_results: int = 3) -> list[dict]:
        query_tokens = tokenize(query)
        if not query_tokens or not self.chunks:
            return []

        scored = []
        query_lower = query.lower()
        for chunk in self.chunks:
            chunk_tokens = chunk["tokens"]
            matches = sum(1 for qt in query_tokens if qt in chunk_tokens)
            if matches > 0:
                content_lower = chunk["content"].lower()
                phrase_bonus = 3 if query_lower in content_lower else 0
                score = matches + phrase_bonus
                scored.append((score, chunk))

        scored.sort(key=lambda x: x[0], reverse=True)
        results = [item[1] for item in scored[:n_results]]

        if not results and self.chunks:
            # If no direct keyword match, fall back to top 2 general guidance chunks
            results = self.chunks[:2]

        return [{"content": r["content"], "source": r["source"]} for r in results]

    def get_context(self, query: str) -> str:
        results = self.search(query, n_results=3)
        if not results:
            return ""

        context_parts = []
        for r in results:
            context_parts.append(f"[Source: {r['source']}]\n{r['content']}")
        return "\n\n---\n\n".join(context_parts)

    def get_stats(self) -> dict:
        return {"total_chunks": len(self.chunks)}

    def clear(self):
        self.chunks = []
        if self.chroma_collection:
            try:
                self.client.delete_collection("documents")
                self.chroma_collection = self.client.get_or_create_collection(name="documents")
            except Exception:
                pass
