from services.chatbot.document_loader import DocumentLoader

class RAGPipeline:
    def __init__(
        self,
        document_loader: DocumentLoader,
        persist_dir: str,
    ):
        import chromadb
        from chromadb.config import Settings

        self.loader = document_loader
        self.client = chromadb.PersistentClient(
            path=persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
        self.collection = self.client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"},
        )

    def add_document(self, filename: str, file_path: str) -> int:
        chunks = self.loader.load_file(file_path)
        if not chunks:
            return 0

        ids = []
        documents = []
        metadatas = []

        for i, chunk in enumerate(chunks):
            doc_id = f"{filename}_{i}"
            ids.append(doc_id)
            documents.append(chunk["content"])
            metadatas.append(chunk["metadata"])

        self.collection.upsert(
            ids=ids,
            documents=documents,
            metadatas=metadatas,
        )
        return len(chunks)

    def search(self, query: str, n_results: int = 5) -> list[dict]:
        results = self.collection.query(query_texts=[query], n_results=n_results)

        docs = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                source = results["metadatas"][0][i].get("source", "unknown")
                docs.append({"content": doc, "source": source})
        return docs

    def get_context(self, query: str) -> str:
        results = self.search(query, n_results=3)
        if not results:
            return ""

        context_parts = []
        for r in results:
            context_parts.append(f"[Source: {r['source']}]\n{r['content']}")
        return "\n\n---\n\n".join(context_parts)

    def get_stats(self) -> dict:
        count = self.collection.count()
        return {"total_chunks": count}

    def clear(self):
        self.client.delete_collection("documents")
        self.collection = self.client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"},
        )
