
import { GoogleGenAI } from "@google/genai";

// Basit bir önbellek mekanizması (Aynı metni tekrar tekrar sormamak için)
const translationCache: Record<string, string> = {};

// Demo Modu için Sözlük (API Key olmadığı durumlar için)
const DEMO_DICTIONARY: Record<string, string> = {
    "Hata düzelt": "Fehler beheben",
    "Sigorta teyit": "Versicherung bestätigen",
    "Fatura": "Rechnung",
    "Faturalar toplanacak": "Rechnungen werden gesammelt",
    "Sisteme giriş yapılacak": "Eingabe in das System",
    "Ön muhasebe girişi yapılacak": "Vorbuchhaltungseintrag wird erstellt",
    "Factoring ile fatura giriş": "Rechnungseingabe mit Factoring",
    "Pefra faturaları": "Pefra Rechnungen",
    "Melisa Gold montaj": "Melisa Gold Montage",
    "Tabela montaj": "Schildermontage"
};

export const translateContent = async (text: string, targetLang: 'tr' | 'de'): Promise<string> => {
    // 1. Boş metin kontrolü
    if (!text || !text.trim()) return text;

    // 2. Önbellek kontrolü
    const cacheKey = `${text}_${targetLang}`;
    if (translationCache[cacheKey]) {
        return translationCache[cacheKey];
    }

    // 3. Hedef dil Türkçe ise ve metin zaten Türkçe gibiyse (basit varsayım) çevirme
    // (Gerçek uygulamada kaynak dil tespiti daha karmaşık olabilir)
    if (targetLang === 'tr') {
        return text; 
    }

    // 4. Demo Sözlük Kontrolü (Hızlı tepki ve API keysiz çalışma için)
    if (targetLang === 'de' && DEMO_DICTIONARY[text]) {
        return DEMO_DICTIONARY[text];
    }

    try {
        // 5. Google Gemini API Çağrısı
        // Not: process.env.API_KEY tanımlı olmalıdır.
        if (process.env.API_KEY) {
            // Fix: Initialize GoogleGenAI with named parameter
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const prompt = `Translate the following text to ${targetLang === 'de' ? 'German' : 'Turkish'}. Return only the translated text, do not add any explanations or quotes.\n\nText: "${text}"`;

            // Fix: Use ai.models.generateContent directly with the correct model and prompt
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
            });

            // Fix: Access the text property directly (not a method)
            const result = response.text?.trim();
            if (result) {
                translationCache[cacheKey] = result;
                return result;
            }
        }
        
        // API Key yoksa simülasyon (Gerçek çeviri gibi görünmesi için)
        // Sadece demo amaçlı, metnin sonuna [DE] ekler.
        return new Promise((resolve) => {
            setTimeout(() => {
                const simulated = `[${targetLang.toUpperCase()}] ${text}`;
                translationCache[cacheKey] = simulated;
                resolve(simulated);
            }, 300); // Küçük bir gecikme ekle
        });

    } catch (error) {
        console.error("Translation error:", error);
        return text; // Hata durumunda orijinal metni döndür
    }
};

export const analyzeInvoice = async (mockImage: string): Promise<string> => {
    // Simulation of Gemini Vision API
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`
            **Fatura Analizi (Gemini AI)**
            -----------------------------
            **Tedarikçi:** Metro Grossmarket
            **Tarih:** 24.10.2023
            **Toplam Tutar:** 1.250,00 €
            
            **Kalemler:**
            1. Kahve Çekirdeği (10kg) - 450€
            2. Süt (50L) - 50€
            3. Temizlik Malzemeleri - 150€
            
            **Kategori:** Gider / Stok
            **Vergi Oranı:** %19
            `);
        }, 2000);
    });
};

export const suggestProductivity = async (tasksCompleted: number, hoursWorked: number): Promise<string> => {
     // Simulation of Gemini Text Generation
     return new Promise((resolve) => {
        setTimeout(() => {
            const ratio = tasksCompleted / hoursWorked;
            if(ratio > 0.5) {
                resolve("Personel performansı bu hafta %15 arttı. Verimlilik yüksek seviyede.");
            } else {
                 resolve("Görev tamamlama hızı standartların biraz altında. İş yükü dağılımının gözden geçirilmesi önerilir.");
            }
        }, 1500);
    });
}

export const analyzeTaskProgress = async (pendingCount: number, highPriorityCount: number): Promise<string> => {
    // Simulation of Gemini Task Analysis
    return new Promise((resolve) => {
        setTimeout(() => {
            // More "creative" executive summary style
            resolve(`**Sistem Özeti:** Şu an ${pendingCount} aktif iş üzerinde çalışılıyor. Dikkat: ${highPriorityCount} kritik görev teslim bekliyor. Montaj ekibi %85 kapasite ile çalışıyor, Backaffee şubesinde operasyonel hız %12 arttı. Tahmini tamamlanma: Cuma, 17:00.`);
        }, 1200);
    });
};
