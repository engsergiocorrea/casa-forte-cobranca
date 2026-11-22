'use client'

// Mostra a tela de carregamento em TODA troca de página: começa no clique de um
// link interno e some quando a nova página aparece. Espera 120ms antes de
// mostrar (navegação instantânea não pisca) e, uma vez visível, fica pelo menos
// 300ms (não dá "flash"). Trava de segurança: some sozinha após 15s.
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { TelaCarregando } from './tela'

function Observador() {
  const pathname = usePathname()
  const busca = useSearchParams()
  const [visivel, setVisivel] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const mostradaEm = useRef(0)
  const ativa = useRef(false)

  const limpar = () => { timers.current.forEach(clearTimeout); timers.current = [] }

  // Início: clique em link interno que leva a outra página.
  useEffect(() => {
    function aoClicar(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a || !a.href || a.hasAttribute('download')) return
      if (a.target && a.target !== '_self') return
      let url: URL
      try { url = new URL(a.href, location.href) } catch { return }
      if (url.origin !== location.origin) return
      if (url.pathname === location.pathname && url.search === location.search) return // mesma página / âncora
      limpar()
      ativa.current = true
      setSaindo(false)
      timers.current.push(setTimeout(() => { mostradaEm.current = Date.now(); setVisivel(true) }, 120))
      timers.current.push(setTimeout(() => { ativa.current = false; setVisivel(false) }, 15000))
    }
    document.addEventListener('click', aoClicar)
    return () => document.removeEventListener('click', aoClicar)
  }, [])

  // Fim: a rota mudou (nova página renderizada).
  const rota = `${pathname}?${busca?.toString() ?? ''}`
  const primeira = useRef(true)
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return }
    if (!ativa.current) return
    ativa.current = false
    limpar()
    const resta = Math.max(0, 300 - (Date.now() - mostradaEm.current))
    timers.current.push(setTimeout(() => setSaindo(true), resta))
    timers.current.push(setTimeout(() => { setVisivel(false); setSaindo(false) }, resta + 220))
  }, [rota])

  useEffect(() => limpar, [])

  if (!visivel) return null
  return <TelaCarregando style={{ opacity: saindo ? 0 : 1, transition: 'opacity 220ms ease', pointerEvents: saindo ? 'none' : 'auto' }} />
}

export function CarregandoEntrePaginas() {
  // useSearchParams exige Suspense no layout raiz.
  return (
    <Suspense fallback={null}>
      <Observador />
    </Suspense>
  )
}
