import os
import json
import logging
from flask import Blueprint, request, jsonify, Response
from services.chatbot.gemini import GeminiService
from services.chatbot.rag import RAGPipeline
from services.chatbot.document_loader import DocumentLoader

logger = logging.getLogger(__name__)

chatbot_bp = Blueprint('chatbot_bp', __name__)

gemini_service = None
rag = None
doc_loader = None

def init_chatbot(api_key: str, model: str, documents_dir: str, persist_dir: str):
    global gemini_service, rag, doc_loader
    gemini_service = GeminiService(api_key=api_key, model=model)
    doc_loader = DocumentLoader(documents_dir=documents_dir)
    rag = RAGPipeline(
        document_loader=doc_loader,
        persist_dir=persist_dir,
    )
    return gemini_service, rag, doc_loader

@chatbot_bp.route("/api/health", methods=["GET"])
def health():
    if not gemini_service:
        return jsonify({"status": "degraded", "ollama": "disconnected", "model": "unknown"}), 503
    gemini_ok = gemini_service.check_health()
    return jsonify({
        "status": "ok" if gemini_ok else "degraded",
        "ollama": "connected" if gemini_ok else "disconnected",
        "model": gemini_service.model,
    })

@chatbot_bp.route("/api/chat", methods=["POST", "OPTIONS"])
def chat():
    if request.method == "OPTIONS":
        return Response(status=200)
    data = request.json
    message = data.get("message", "")
    history_data = data.get("history", [])

    history = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in history_data]

    try:
        context = rag.get_context(message)
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        context = ""

    def event_stream():
        try:
            for token in gemini_service.stream_chat(
                message=message, history=history, context=context
            ):
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            logger.error(f"Chat error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")

@chatbot_bp.route("/api/documents/upload", methods=["POST"])
def upload_document():
    if 'file' not in request.files:
        return jsonify({"detail": "No file uploaded"}), 400
    file = request.files['file']
    filename = file.filename
    # Assuming DOCUMENTS_DIR is setup in init
    if not doc_loader:
        return jsonify({"detail": "Service not initialized"}), 500
        
    save_path = os.path.join(doc_loader.documents_dir, filename)
    file.save(save_path)
    
    try:
        chunk_count = rag.add_document(filename, save_path)
        return jsonify({
            "filename": filename,
            "chunks": chunk_count,
            "status": "success",
        })
    except Exception as e:
        return jsonify({"detail": str(e)}), 500

@chatbot_bp.route("/api/documents", methods=["GET"])
def list_documents():
    docs = doc_loader.list_documents()
    stats = rag.get_stats()
    return jsonify({"documents": docs, "stats": stats})

@chatbot_bp.route("/api/documents", methods=["DELETE"])
def clear_documents():
    rag.clear()
    return jsonify({"status": "cleared"})
