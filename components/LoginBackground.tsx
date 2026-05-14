import React, { useEffect, useMemo, useState } from 'react';

/**
 * Login sayfası arka planı — public/backgrounds/bg-1.jpg .. bg-7.jpg
 * görsellerini rastgele sırada crossfade ile döndürür.
 *
 * - Mobil + desktop: background-size: cover ile tam ekran.
 * - 7 görsel de DOM'da render edilir, sadece aktif olanın opacity'si 1.
 * - Browser tüm görselleri paralel preload eder (ilk fade hazır).
 * - prefers-reduced-motion: fade süresi public/index.css'te kısaltılır.
 */

const BG_COUNT = 7;
const ROTATION_MS = 60 * 60 * 1000;  // 1 saat

const shuffle = (n: number): number[] => {
    const arr = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

const LoginBackground: React.FC = () => {
    const order = useMemo(() => shuffle(BG_COUNT), []);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const id = window.setInterval(() => {
            setIndex((i) => (i + 1) % BG_COUNT);
        }, ROTATION_MS);
        return () => window.clearInterval(id);
    }, []);

    return (
        <div className="login-bg" aria-hidden="true">
            {order.map((bgNum, i) => (
                <div
                    key={bgNum}
                    className={`login-bg-layer${i === index ? ' is-active' : ''}`}
                    style={{ backgroundImage: `url("/backgrounds/bg-${bgNum}.jpg")` }}
                />
            ))}
            <div className="login-bg-overlay" />
        </div>
    );
};

export default LoginBackground;
