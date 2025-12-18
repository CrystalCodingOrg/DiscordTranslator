import { GoogleGenAI } from "@google/genai";
import { 
    getTranslationFromHistory, 
    saveTranslationToHistory 
} from "./mysql";

const ai = new GoogleGenAI({});

export type TranslationResult = {
    original_message: string;
    translated_message: string;
    detected_language: string;
    from_cache?: boolean;
};

export async function translate(
    message: string,
    language: string = "english",
    discordId?: string,
    username?: string
): Promise<TranslationResult> {
    // Check history first
    const cachedTranslation = await getTranslationFromHistory(message, language);
    
    if (cachedTranslation) {
        console.log("✨ Translation found in cache");
        return {
            original_message: cachedTranslation.original_message,
            translated_message: cachedTranslation.translated_message,
            detected_language: cachedTranslation.detected_language || "unknown",
            from_cache: true,
        };
    }

    console.log("🔄 Requesting new translation from Gemini");
    
    // Not in cache, use Gemini
    // Sanitize inputs to prevent prompt injection
    const sanitizedMessage = message.replace(/"/g, '\\"').slice(0, 2000); // Escape quotes and limit length
    const sanitizedLanguage = language.replace(/[^a-zA-Z\s-]/g, '').slice(0, 50); // Allow only letters, spaces, hyphens

    const prompt = `
You are a translator. Output ONLY JSON in the following format:

{
  "original_message": string,
  "translated_message": string,
  "detected_language": string
}

Translate the following message into ${sanitizedLanguage}:

"${sanitizedMessage}"

Do NOT include any extra text, commentary, markdown, or backticks.
`;

    const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        contents: prompt,
        config: {
            temperature: 0, // deterministic output
        },
    });

    const rawText = (response.text ?? "").trim();

    // Remove any lingering ```json or ``` marks
    const cleanedText = rawText.replace(/```json|```/g, "").trim();

    let jsonResponse: Partial<TranslationResult> = {};

    try {
        // Try normal JSON parse
        jsonResponse = JSON.parse(cleanedText);
    } catch {
        try {
            // Fallback: replace unquoted keys with quoted ones (common AI error)
            const repaired = cleanedText.replace(
                /(['"])?([a-zA-Z0-9_]+)\1?\s*:/g,
                '"$2":'
            );
            jsonResponse = JSON.parse(repaired);
        } catch (err) {
            throw new Error(
                "Failed to parse AI response as JSON: " +
                (response.text ?? String(err))
            );
        }
    }

    const result = {
        original_message: jsonResponse.original_message ?? message,
        translated_message: jsonResponse.translated_message ?? message,
        detected_language: jsonResponse.detected_language ?? "unknown",
        from_cache: false,
    };

    // Save to history for future use
    await saveTranslationToHistory(
        result.original_message,
        language,
        result.detected_language,
        result.translated_message,
        discordId,
        username
    );

    return result;
}
