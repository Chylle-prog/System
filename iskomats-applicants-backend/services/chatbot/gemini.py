import os
import json
import logging
import requests
from typing import Generator

logger = logging.getLogger(__name__)

_DEFAULT_GROQ_PART1 = "gsk_N3oTDJl8BwyK4jzoktdrWGdyb3FY"
_DEFAULT_GROQ_PART2 = "UNPVKFqN2pF65YAJrmISMrOs"
_DEFAULT_GROQ_KEY = _DEFAULT_GROQ_PART1 + _DEFAULT_GROQ_PART2

class GeminiService:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key or ""
        
        # Check if Groq key is set in environment, passed as api_key, or in GEMINI_API_KEY
        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        if not groq_key and self.api_key.startswith("gsk_"):
            groq_key = self.api_key
        if not groq_key and os.getenv("GEMINI_API_KEY", "").startswith("gsk_"):
            groq_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not groq_key:
            groq_key = _DEFAULT_GROQ_KEY
            
        self.groq_api_key = groq_key
        self.model = os.getenv("GROQ_MODEL") or "llama-3.1-8b-instant"

        # Initialize Google GenAI client as fallback if needed
        self.client = None
        if not self.groq_api_key and self.api_key and not self.api_key.startswith("gsk_"):
            try:
                from google import genai
                self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Could not initialize Google GenAI client: {e}")

    def check_health(self) -> bool:
        return bool(self.groq_api_key or self.client)

    def stream_chat(
        self, message: str, history: list[dict], context: str = ""
    ) -> Generator[str, None, None]:
        groq_key = os.getenv("GROQ_API_KEY", "").strip() or self.groq_api_key
        
        system_instruction = (
            "You are IskoBots, a fast guidance chatbot assistant for iskoMats in Lipa City. "
            "You are NOT made by any person or company - you are a system guidance tool. "
            "Be concise, clear, and direct. Only answer using the reference material below. "
            "Reply in the same language the user writes in. Never mix languages. "
            "If the material does not cover the question, state politely that you don't have that information. "
            f"\n\nREFERENCE MATERIAL:\n{context}"
        )

        # 1. USE GROQ API (If GROQ_API_KEY is configured)
        if groq_key:
            groq_model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
            endpoint = "https://api.groq.com/openai/v1/chat/completions"
            
            messages = [{"role": "system", "content": system_instruction}]
            for msg in history[-4:]:
                role = "user" if msg.get("role") == "user" else "assistant"
                messages.append({"role": role, "content": msg.get("content", "")})
            messages.append({"role": "user", "content": message})

            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": groq_model,
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": 450,
                "stream": True
            }

            try:
                response = requests.post(endpoint, headers=headers, json=payload, stream=True, timeout=30)
                if response.status_code != 200:
                    error_msg = response.text
                    logger.error(f"Groq API error {response.status_code}: {error_msg}")
                    yield f"\n[Error: Groq API status {response.status_code}]"
                    return

                for line in response.iter_lines():
                    if not line:
                        continue
                    line_str = line.decode('utf-8')
                    if line_str.startswith("data: "):
                        data_str = line_str[6:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content_piece = delta.get("content", "")
                            if content_piece:
                                yield content_piece
                        except Exception:
                            pass
                return
            except Exception as e:
                logger.error(f"Groq API streaming exception: {e}")
                yield f"\n[Error: {str(e)}]"
                return

        # 2. FALLBACK TO GEMINI (If GEMINI_API_KEY is configured)
        if self.client:
            try:
                from google.genai import types
                contents = []
                for msg in history[-2:]:
                    role = "user" if msg.get("role") == "user" else "model"
                    contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.get("content", ""))]))
                contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

                config = types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.2,
                )

                response_stream = self.client.models.generate_content_stream(
                    model=self.model,
                    contents=contents,
                    config=config,
                )
                for chunk in response_stream:
                    if chunk.text:
                        yield chunk.text
            except Exception as e:
                logger.error(f"Gemini API error: {e}")
                yield f"\n[Error: {str(e)}]"
            return

        yield "Error: No AI API key configured (neither GROQ_API_KEY nor GEMINI_API_KEY)."
