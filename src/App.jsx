import React, { useEffect, useMemo, useState } from 'react'

// Top 20 vesztesek elemző – kliensoldali, ingyen futtatható (GitHub Pages / helyi fájlból)
// Követelmények: Alpha Vantage ingyenes API kulcs (https://www.alphavantage.co/support/#api-key)
// Funkciók:
//  - Előző nyitott kereskedési nap 20 legnagyobb vesztesének lekérése (US piac)
//  - Rövid hír-alapú okfeltárás (NEWS_SENTIMENT endpoint)
//  - 30 napos átlagos forgalom (TIME_SERIES_DAILY_ADJUSTED)
//  - Egyszerű, szabály alapú javaslat: "Vétel / Várakozás / Kerülendő"
//  - Mindez ingyen, tárhely nélkül: futtasd helyben vagy GitHub Pages-en

// *** FONTOS MEGJEGYZÉS ***
// Az ingyenes Alpha Vantage kulcs erősen limitált (percenkénti és napi kvóták). A 20 részvény részletes
// elemzéséhez több kérés szükséges (news + idősor). Ha a kvótába ütközöl, kapcsold be a "Gyors előnézet" módot,
// ami csak az első 5 szimbólumra futtat részleteket, vagy futtasd többször pár perces szünetekkel.

const AV_BASE = 'https://www.alphavantage.co/query'

// Egyszerű késleltetés a kvóta kíméléséhez
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

function classNames(...args) {
    return args.filter(Boolean).join(' ')
}

function Info({ label, value }) {
    return (
        <div className="flex gap-2 text-sm">
            <span className="text-gray-500 min-w-40">{label}:</span>
            <span className="font-medium">{value}</span>
        </div>
    )
}

// Heurisztikus szabályok a javaslathoz a hírek és az esés mértéke alapján
function makeRecommendation({ changePct, sentimentScore, headlines }) {
    const drop = Math.abs(changePct)
    const badWords = [
        /guidance cut/i,
        /sec (investigation|probe|charges)/i,
        /fraud|accounting/i,
        /bankrupt|bankruptcy/i,
        /going concern/i,
        /delist/i,
    ]
    const cautionWords = [
        /earnings miss|revenue miss|profit warning/i,
        /secondary offering|share offering|dilution|convertible/i,
        /downgrade/i,
        /recall/i,
    ]

    const headlinesText = (headlines || []).join(' \n')
    const hasBad = badWords.some((re) => re.test(headlinesText))
    const hasCaution = cautionWords.some((re) => re.test(headlinesText))

    if (hasBad || sentimentScore <= -0.35 || drop >= 20) {
        return {
            label: 'Kerülendő',
            reason: 'Erősen negatív hír/szenzitív kockázat vagy extrém esés.',
        }
    }
    if (hasCaution || sentimentScore < 0 || drop >= 10) {
        return {
            label: 'Várakozás',
            reason: 'Vegyes/negatív hangulat vagy jelentős esés – várj megerősítésre.',
        }
    }
    return {
        label: 'Vétel (spekulatív)',
        reason: 'Mérsékelt esés és nem kirívóan negatív hírek.',
    }
}

async function fetchJson(url) {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
}

async function getTopLosers(apiKey) {
    const url = `${AV_BASE}?function=TOP_GAINERS_LOSERS&apikey=${apiKey}`
    const data = await fetchJson(url)
    // Visszaad: { top_losers: [ { ticker, price, change_amount, change_percentage, volume, ... } ], last_updated: "YYYY-MM-DD" }
    if (!data?.top_losers)
        throw new Error(
            'Nem sikerült lekérni a vesztesek listáját. Lehet, hogy elfogyott az API kvóta.'
        )
    // A TOP_GAINERS_LOSERS az utolsó elérhető kereskedési napra vonatkozik; azt a last_updated mező mutatja.
    return {
        losers: data.top_losers.slice(0, 20),
        lastUpdated: data.last_updated,
    }
}

async function getDailySeriesAverages(apiKey, symbol, days = 30) {
    // 30 napos átlagos napi forgalom
    const url = `${AV_BASE}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
        symbol
    )}&outputsize=compact&apikey=${apiKey}`
    const data = await fetchJson(url)
    const series = data['Time Series (Daily)'] || {}
    const dates = Object.keys(series).sort((a, b) => (a < b ? 1 : -1))
    let total = 0,
        n = 0
    for (let i = 0; i < Math.min(days, dates.length); i++) {
        const d = dates[i]
        const v = Number(series[d]['6. volume'] || 0)
        if (!isNaN(v)) {
            total += v
            n++
        }
    }
    return n ? Math.round(total / n) : null
}

async function getNewsSentiment(apiKey, symbol) {
    // Alpha Vantage NEWS_SENTIMENT – utolsó 7 nap, max 50 cikk
    const now = new Date()
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const toStr = now.toISOString().slice(0, 19)
    const fromStr = from.toISOString().slice(0, 19)
    const url = `${AV_BASE}?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(
        symbol
    )}&time_from=${fromStr}&time_to=${toStr}&sort=LATEST&limit=50&apikey=${apiKey}`
    const data = await fetchJson(url)
    const feed = data?.feed || []
    const headlines = feed.slice(0, 5).map((x) => x.title)
    // Átlagolt sentiment_score, ha van
    let score = null
    let n = 0
    for (const item of feed) {
        const s = Number(item?.overall_sentiment_score)
        if (!isNaN(s)) {
            score = (score === null ? 0 : score) + s
            n++
        }
    }
    const avgScore = n ? score / n : 0
    return { headlines, sentimentScore: avgScore }
}

function formatNumber(n) {
    if (n == null) return '–'
    return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
    }).format(n)
}

function formatPct(p) {
    if (p == null) return '–'
    const num =
        typeof p === 'string' && p.endsWith('%')
            ? Number(p.replace('%', ''))
            : Number(p)
    return `${num.toFixed(2)}%`
}

export default function App() {
    const [apiKey, setApiKey] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [rows, setRows] = useState([])
    const [fastPreview, setFastPreview] = useState(true)
    const [log, setLog] = useState([])

    const addLog = (msg) => setLog((L) => [msg, ...L].slice(0, 100))

    const run = async () => {
        setError(null)
        setLoading(true)
        setRows([])
        setLog([])
        try {
            if (!apiKey)
                throw new Error('Add meg az Alpha Vantage API kulcsot!')
            addLog('Vesztesek lekérése...')
            const { losers, lastUpdated } = await getTopLosers(apiKey)
            setLastUpdated(lastUpdated)
            const limited = fastPreview ? losers.slice(0, 5) : losers

            const out = []
            for (let i = 0; i < limited.length; i++) {
                const l = limited[i]
                const symbol = l.ticker
                addLog(
                    `(${i + 1}/${
                        limited.length
                    }) ${symbol}: hírek és forgalom lekérése...`
                )
                // Kvóta-kímélés: 1.5s szünet a hívások között
                await sleep(1500)
                let news = { headlines: [], sentimentScore: 0 }
                try {
                    news = await getNewsSentiment(apiKey, symbol)
                } catch (e) {
                    addLog(`${symbol}: NEWS_SENTIMENT hiba – ${e.message}`)
                }
                await sleep(1500)
                let avgVol = null
                try {
                    avgVol = await getDailySeriesAverages(apiKey, symbol, 30)
                } catch (e) {
                    addLog(`${symbol}: TIME_SERIES hiba – ${e.message}`)
                }

                const pctStr = (l.change_percentage || '').replace('%', '')
                const pct = Number(pctStr)
                const rec = makeRecommendation({
                    changePct: pct,
                    sentimentScore: news.sentimentScore,
                    headlines: news.headlines,
                })

                out.push({
                    symbol,
                    price: Number(l.price),
                    changePct: pct,
                    changeAmt: Number(l.change_amount),
                    volume: Number(l.volume || 0),
                    avgVolume30d: avgVol,
                    headlines: news.headlines,
                    sentiment: news.sentimentScore,
                    recommendation: rec.label,
                    recReason: rec.reason,
                })
            }
            setRows(out)
        } catch (e) {
            setError(e.message || String(e))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                <header className="flex items-center justify-between">
                    <h1 className="text-2xl sm:text-3xl font-bold">
                        Top 20 napi vesztes – okok és javaslat
                    </h1>
                    <a
                        href="https://www.alphavantage.co/support/#api-key"
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline"
                    >
                        Szerezz ingyenes API kulcsot
                    </a>
                </header>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-2xl shadow p-4 md:col-span-2">
                        <div className="flex flex-col gap-3">
                            <Info
                                label="Működés"
                                value="Kliensoldali, bárhonnan futtatható. Töltsd fel GitHub Pages-re vagy nyisd meg helyben."
                            />
                            <Info
                                label="Piac"
                                value="US részvények (Alpha Vantage TOP_GAINERS_LOSERS)"
                            />
                            <Info
                                label="Elemzés forrása"
                                value="Alpha Vantage NEWS_SENTIMENT + 30 napos átlagforgalom"
                            />
                            <Info
                                label="Korlát"
                                value="Ingyenes kvóta: ha ütközöl, kapcsold be a Gyors előnézetet (5 db)."
                            />
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl shadow p-4 space-y-3">
                        <label className="text-sm">
                            Alpha Vantage API kulcs
                        </label>
                        <input
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="pl. ABCD1234..."
                            className="w-full border rounded-xl px-3 py-2"
                        />
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={fastPreview}
                                onChange={(e) =>
                                    setFastPreview(e.target.checked)
                                }
                            />{' '}
                            Gyors előnézet (top 5 részletesen)
                        </label>
                        <button
                            onClick={run}
                            disabled={loading}
                            className={classNames(
                                'w-full rounded-2xl px-4 py-2 font-semibold',
                                loading
                                    ? 'bg-gray-300'
                                    : 'bg-black text-white hover:bg-gray-800'
                            )}
                        >
                            {loading ? 'Fut...' : 'Lekérdezés indítása'}
                        </button>
                        {lastUpdated && (
                            <div className="text-xs text-gray-500">
                                Utolsó kereskedési nap a listában: {lastUpdated}
                            </div>
                        )}
                        {error && (
                            <div className="text-sm text-red-600">
                                Hiba: {error}
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 bg-white rounded-2xl shadow overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="text-left p-2">#</th>
                                    <th className="text-left p-2">Ticker</th>
                                    <th className="text-right p-2">Ár</th>
                                    <th className="text-right p-2">Változás</th>
                                    <th className="text-right p-2">
                                        Napi forgalom
                                    </th>
                                    <th className="text-right p-2">
                                        Átlag forgalom (30d)
                                    </th>
                                    <th className="text-left p-2">Javaslat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, idx) => (
                                    <tr key={r.symbol} className="border-t">
                                        <td className="p-2">{idx + 1}</td>
                                        <td className="p-2 font-semibold">
                                            {r.symbol}
                                        </td>
                                        <td className="p-2 text-right">
                                            {r.price?.toFixed(2)}
                                        </td>
                                        <td
                                            className={classNames(
                                                'p-2 text-right',
                                                r.changePct <= 0
                                                    ? 'text-red-600'
                                                    : 'text-green-600'
                                            )}
                                        >
                                            {formatPct(r.changePct)}
                                        </td>
                                        <td className="p-2 text-right">
                                            {formatNumber(r.volume)}
                                        </td>
                                        <td className="p-2 text-right">
                                            {formatNumber(r.avgVolume30d)}
                                        </td>
                                        <td className="p-2">
                                            <span
                                                className={classNames(
                                                    'px-2 py-1 rounded-full text-xs font-semibold',
                                                    r.recommendation ===
                                                        'Kerülendő' &&
                                                        'bg-red-100 text-red-700',
                                                    r.recommendation ===
                                                        'Várakozás' &&
                                                        'bg-amber-100 text-amber-700',
                                                    r.recommendation?.startsWith(
                                                        'Vétel'
                                                    ) &&
                                                        'bg-emerald-100 text-emerald-700'
                                                )}
                                            >
                                                {r.recommendation}
                                            </span>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {r.recReason}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && !loading && (
                                    <tr>
                                        <td
                                            className="p-4 text-center text-gray-500"
                                            colSpan={7}
                                        >
                                            Még nincs adat. Add meg a kulcsot és
                                            indítsd a lekérdezést.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="bg-white rounded-2xl shadow p-4 space-y-3">
                        <h2 className="font-semibold">Hírcímek és hangulat</h2>
                        {rows.map((r) => (
                            <div
                                key={r.symbol}
                                className="border rounded-xl p-3"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="font-semibold">
                                        {r.symbol}
                                    </div>
                                    <div
                                        className={classNames(
                                            'text-xs px-2 py-0.5 rounded-full',
                                            r.sentiment < -0.2 &&
                                                'bg-red-100 text-red-700',
                                            r.sentiment >= -0.2 &&
                                                r.sentiment <= 0.2 &&
                                                'bg-gray-100 text-gray-700',
                                            r.sentiment > 0.2 &&
                                                'bg-emerald-100 text-emerald-700'
                                        )}
                                    >
                                        Sentiment: {r.sentiment.toFixed(2)}
                                    </div>
                                </div>
                                <ul className="list-disc ml-5 mt-2 text-sm">
                                    {r.headlines?.length ? (
                                        r.headlines.map((h, i) => (
                                            <li key={i}>{h}</li>
                                        ))
                                    ) : (
                                        <li className="text-gray-500">
                                            Nincs friss hír vagy kvóta-limit.
                                        </li>
                                    )}
                                </ul>
                            </div>
                        ))}
                        {rows.length === 0 && !loading && (
                            <div className="text-sm text-gray-500">
                                Itt jelennek meg a részvényenkénti hírek és az
                                átlagolt hangulat.
                            </div>
                        )}

                        {log.length > 0 && (
                            <div className="mt-4">
                                <h3 className="font-semibold mb-2">
                                    Folyamatnapló
                                </h3>
                                <div className="text-xs bg-gray-50 border rounded-xl p-2 max-h-64 overflow-auto space-y-1">
                                    {log.map((m, i) => (
                                        <div key={i}>• {m}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <footer className="text-xs text-gray-500 pt-4">
                    * Figyelmeztetés: ez nem minősül befektetési tanácsnak. A
                    hír-alapú magyarázat és javaslat heurisztikus, tévedhet.
                </footer>
            </div>
        </div>
    )
}
