import os
from typing import Generator
from google import genai
from google.genai import types
import logging

logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        self.client = genai.Client(api_key=self.api_key) if self.api_key else None

    def check_health(self) -> bool:
        if not self.client:
            return False
        return True

    def stream_chat(
        self, message: str, history: list[dict], context: str = ""
    ) -> Generator[str, None, None]:
        if not self.client:
            yield "Error: Gemini API key is not configured."
            return

        system_instruction = (
            "You are IskoBots, a guidance chatbot assistant for iskoMats in Lipa City. "
            "You are NOT made by any person or company - you are a system guidance tool. "
            "Only answer using the reference material below. "
            "Reply in the same language the user writes in. Never mix languages. "
            "If the material does not cover the question, say you don't have that information. "
            f"\n\nREFERENCE MATERIAL:\n{context}"
        )

        contents = []
        for msg in history[-2:]:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg["content"])]))
        
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.2,
        )

        try:
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
