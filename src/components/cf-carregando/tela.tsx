// Tela de carregamento padrão do ecossistema Casa Forte (igual em todos os
// sistemas): fundo laranja da marca, logo branca, barra de progresso animada e
// "Carregando…". Sem 'use client': é só CSS, serve para loading.tsx (servidor)
// e para a transição entre páginas (entre-paginas.tsx).
import type { CSSProperties } from 'react'

export const CF_CARREGANDO_FUNDO = '#E8390E'

const CSS = `
.cfc{position:fixed;inset:0;z-index:9999;background:${CF_CARREGANDO_FUNDO};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:24px;box-sizing:border-box;animation:cfcEntra .18s ease-out}
.cfc img{width:min(260px,62vw);height:auto;filter:brightness(0) invert(1);user-select:none;-webkit-user-drag:none}
.cfc-barra{position:relative;width:min(220px,56vw);height:4px;border-radius:999px;background:rgba(255,255,255,.28);overflow:hidden}
.cfc-barra::after{content:"";position:absolute;top:0;bottom:0;left:0;width:40%;border-radius:999px;background:#fff;animation:cfcBarra 1.1s cubic-bezier(.65,0,.35,1) infinite}
.cfc-texto{margin:0;color:#fff;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:.92}
@keyframes cfcBarra{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@keyframes cfcEntra{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.cfc{animation:none}.cfc-barra::after{animation-duration:2.4s}}
`

export function TelaCarregando({ style, texto = 'Carregando…' }: { style?: CSSProperties; texto?: string }) {
  return (
    <div className="cfc" role="status" aria-live="polite" style={style}>
      <style>{CSS}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/marca/logo-claro.png" alt="Casa Forte" />
      <div className="cfc-barra" aria-hidden />
      <p className="cfc-texto">{texto}</p>
    </div>
  )
}
