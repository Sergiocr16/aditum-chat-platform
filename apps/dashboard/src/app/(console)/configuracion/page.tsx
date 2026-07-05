'use client';

// /configuracion — specs 1k (Widget), 1p (SLA), 1o (Sitios conectados), 1j+1m (Equipo).
// Solo visible para rol Admin.

import { useState } from 'react';
import type { Idioma } from '@aditum-chat/shared';
import { useAuth } from '@/lib/auth';
import { WidgetConfigTab } from '@/components/config/WidgetConfigTab';
import { SlaConfigTab } from '@/components/config/SlaConfigTab';
import { SitiosTab } from '@/components/config/SitiosTab';
import { EquipoTab } from '@/components/config/EquipoTab';
import { EtiquetasTab } from '@/components/config/EtiquetasTab';

type Tab = 'widget' | 'sla' | 'sitios' | 'etiquetas' | 'equipo';

const M = {
  es: {
    titulo: 'Configuración',
    subtitulo: 'Solo visible para rol Admin',
    tabs: {
      widget: 'Widget',
      sla: 'SLA',
      sitios: 'Sitios conectados',
      etiquetas: 'Etiquetas',
      equipo: 'Equipo y roles',
    },
    soloAdmin: 'Solo administradores',
    soloAdminSub: 'Esta sección es exclusiva del rol Admin. Pedile acceso a un administrador.',
  },
  en: {
    titulo: 'Settings',
    subtitulo: 'Only visible to the Admin role',
    tabs: {
      widget: 'Widget',
      sla: 'SLA',
      sitios: 'Connected sites',
      etiquetas: 'Tags',
      equipo: 'Team and roles',
    },
    soloAdmin: 'Admins only',
    soloAdminSub: 'This section is exclusive to the Admin role. Ask an administrator for access.',
  },
} as const;

const TABS: Tab[] = ['widget', 'sla', 'sitios', 'etiquetas', 'equipo'];

export default function ConfiguracionPage() {
  const { agent, loading } = useAuth();
  const idioma: Idioma = agent?.idioma ?? 'es';
  const m = M[idioma];
  const [tab, setTab] = useState<Tab>('widget');

  if (loading || !agent) {
    return <div className="h-full flex items-center justify-center text-warm-gray">…</div>;
  }

  // Guard: solo Admin.
  if (agent.perfil?.rol !== 'admin') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-sm">
          <span className="msr text-[44px] text-warm-gray-3 block mb-3">shield_person</span>
          <div className="text-[15px] font-bold text-ink">{m.soloAdmin}</div>
          <p className="text-[12.5px] text-warm-gray mt-1.5">{m.soloAdminSub}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header con tabs horizontales */}
      <header className="flex-none bg-white border-b border-warm-border px-4 sm:px-6 pt-5">
        <h1 className="text-[17px] font-bold text-ink">{m.titulo}</h1>
        <p className="text-[11.5px] text-warm-gray mt-0.5">{m.subtitulo}</p>
        <nav className="flex gap-1 mt-4 -mb-px overflow-x-auto">
          {TABS.map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3.5 py-2.5 text-[12.5px] font-semibold border-b-2 transition-colors whitespace-nowrap flex-none ${
                tab === k
                  ? 'border-navy text-navy'
                  : 'border-transparent text-warm-gray hover:text-ink'
              }`}
            >
              {m.tabs[k]}
            </button>
          ))}
        </nav>
      </header>

      {/* Contenido de la tab activa */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {tab === 'widget' && <WidgetConfigTab />}
        {tab === 'sla' && <SlaConfigTab />}
        {tab === 'sitios' && <SitiosTab />}
        {tab === 'etiquetas' && <EtiquetasTab />}
        {tab === 'equipo' && <EquipoTab />}
      </div>
    </div>
  );
}
