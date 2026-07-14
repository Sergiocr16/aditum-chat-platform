'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

// White-stroke variant of the chat doodle pattern (globals.css has the navy one).
const DOODLE_BLANCO = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320' viewBox='0 0 320 320'%3E%3Cg fill='none' stroke='%23FFFFFF' stroke-opacity='0.033' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cg transform='translate(22,20) rotate(-8)'%3E%3Cpath d='M2 12 L13 3 L24 12 V24 H2 Z'/%3E%3Cpath d='M10 24 V17 H16 V24'/%3E%3C/g%3E%3Cg transform='translate(120,38) rotate(6)'%3E%3Cpath d='M2 4 Q2 1 5 1 H21 Q24 1 24 4 V13 Q24 16 21 16 H10 L4 21 V16 Q2 16 2 13 Z'/%3E%3Cpath d='M7 7 H19 M7 11 H15'/%3E%3C/g%3E%3Cg transform='translate(228,24) rotate(24)'%3E%3Ccircle cx='7' cy='7' r='5'/%3E%3Cpath d='M11 11 L24 24 M18 18 L21 15 M21 21 L24 18'/%3E%3C/g%3E%3Cg transform='translate(60,120) rotate(4)'%3E%3Crect x='2' y='2' width='18' height='26' rx='1'/%3E%3Cpath d='M7 8 H9 M13 8 H15 M7 14 H9 M13 14 H15 M7 20 H9 M13 20 H15'/%3E%3C/g%3E%3Cg transform='translate(170,132) rotate(-6)'%3E%3Crect x='1' y='4' width='24' height='20' rx='2'/%3E%3Cpath d='M1 10 H25 M7 1 V6 M19 1 V6'/%3E%3C/g%3E%3Cg transform='translate(268,120) rotate(10)'%3E%3Cpath d='M12 2 L15 9 L23 10 L17 15 L19 23 L12 19 L5 23 L7 15 L1 10 L9 9 Z'/%3E%3C/g%3E%3Cg transform='translate(24,220) rotate(8)'%3E%3Cpath d='M2 6 H24 V11 Q21 11 21 14 Q21 17 24 17 V22 H2 V17 Q5 17 5 14 Q5 11 2 11 Z'/%3E%3Cpath d='M10 10 V12 M10 16 V18'/%3E%3C/g%3E%3Cg transform='translate(130,236) rotate(-18)'%3E%3Cpath d='M20 3 Q25 5 24 10 L14 20 Q16 25 12 27 Q8 29 5 26 Q2 23 4 19 Q6 15 11 17 L21 7 Q19 4 20 3 Z'/%3E%3C/g%3E%3Cg transform='translate(232,214) rotate(-8)'%3E%3Cpath d='M3 1 H16 L22 7 V27 H3 Z M16 1 V7 H22'/%3E%3Cpath d='M7 13 H18 M7 18 H18 M7 23 H14'/%3E%3C/g%3E%3Cg transform='translate(88,288) rotate(-4)'%3E%3Cpath d='M9 16 Q1 10 1 5.5 Q1 1 5 1 Q8 1 9 4 Q10 1 13 1 Q17 1 17 5.5 Q17 10 9 16 Z'/%3E%3C/g%3E%3Cg transform='translate(196,290) rotate(12)'%3E%3Ccircle cx='10' cy='10' r='9'/%3E%3Cpath d='M10 5 V15 M7 7.5 Q10 5.5 13 7.5 M7 12.5 Q10 14.5 13 12.5'/%3E%3C/g%3E%3Cg transform='translate(282,282) rotate(-14)'%3E%3Crect x='1' y='3' width='22' height='15' rx='2'/%3E%3Cpath d='M1 5 L12 12 L23 5'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`;

export default function LoginPage() {
  const { agent, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && agent) router.replace('/inbox');
  }, [loading, agent, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/inbox');
    } catch {
      setError('Credenciales inválidas. Revisá el correo y la contraseña.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-[#FDFCFA]">
      {/* Panel de marca: banda compacta en móvil, columna completa en escritorio */}
      <aside
        className="relative bg-[#2C1C2C] text-white overflow-hidden flex flex-col justify-center lg:justify-start px-6 py-5 pt-[max(1.25rem,env(safe-area-inset-top))] lg:p-12"
        style={{ backgroundImage: DOODLE_BLANCO, backgroundSize: '320px' }}
      >
        <div className="flex items-center gap-3 self-start relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aditum-chat-icon.png" alt="" className="h-9 w-9 rounded-[10px]" />
          <span className="text-[16px] font-bold tracking-[0.14em] leading-none">
            ADITUM <span className="text-white/60 font-semibold">CHAT</span>
          </span>
        </div>

        <div className="hidden lg:block mt-auto relative max-w-[460px]">
          {/* Vista en miniatura de una conversación real: el producto se presenta solo */}
          <div className="text-[13.5px] leading-snug">
            <div className="bg-white/[.08] border border-white/10 rounded-2xl rounded-bl-md px-4 py-2.5 w-fit max-w-[280px]">
              ¿Cómo reservo la cancha de tenis?
            </div>
            <div className="bg-white text-[#26241F] rounded-2xl rounded-br-md px-4 py-3 w-fit max-w-[330px] ml-10 mt-2.5 shadow-[0_12px_32px_rgba(0,0,0,.25)]">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="msr text-[14px] text-[#7A4FB3]">smart_toy</span>
                <span className="text-[11px] font-bold text-[#7A4FB3]">Aden</span>
              </div>
              Desde tu app Aditum: Reservas, elegí Cancha de tenis y confirmá la hora. ¿Te muestro
              los espacios libres de hoy?
            </div>
          </div>

          <h1 className="text-[30px] font-bold leading-tight mt-10">Consola de soporte</h1>
          <p className="text-[14px] text-white/70 mt-3 leading-relaxed max-w-[400px]">
            Atendé las conversaciones y tickets de los administradores de condominios, con el bot de
            Claude como primera línea.
          </p>
          <div className="flex items-center gap-2 mt-7">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#4ADE80] opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4ADE80]" />
            </span>
            <span className="text-[12px] text-white/60">Atención en tiempo real · Bot con Claude</span>
          </div>
        </div>
      </aside>

      {/* Formulario */}
      <main className="flex items-center justify-center px-6 py-12 lg:px-16">
        <form onSubmit={submit} className="w-full max-w-[380px]">
          <h2 className="text-[24px] font-bold text-[#26241F] tracking-[-0.01em]">Iniciar sesión</h2>
          <p className="text-[13px] text-[#8A8375] mt-1.5">Ingresá con tu cuenta de Aditum</p>

          <div className="mt-8">
            <label className="block text-[11.5px] font-semibold text-[#6E675C] mb-1.5">
              Correo electrónico
            </label>
            <div className="flex items-center gap-2.5 border border-[#E4DFD6] rounded-[10px] px-3 py-[11px] bg-[#FBFAF8] focus-within:border-[#5D3A5F] focus-within:bg-white transition-colors">
              <span className="msr text-[17px] text-[#A9A294]">mail</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="lcampos@aditumcr.com"
                className="flex-1 bg-transparent outline-none text-[13.5px] text-[#26241F] placeholder:text-[#B7B0A2]"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-[11.5px] font-semibold text-[#6E675C] mb-1.5">
              Contraseña
            </label>
            <div className="flex items-center gap-2.5 border border-[#E4DFD6] rounded-[10px] px-3 py-[11px] bg-[#FBFAF8] focus-within:border-[#5D3A5F] focus-within:bg-white transition-colors">
              <span className="msr text-[17px] text-[#A9A294]">lock</span>
              <input
                type={verClave ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="flex-1 bg-transparent outline-none text-[13.5px] text-[#26241F] tracking-[3px] placeholder:tracking-[3px] placeholder:text-[#B7B0A2]"
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                className="msr text-[17px] text-[#A9A294] hover:text-[#6E675C]"
                aria-label="Mostrar/ocultar contraseña"
              >
                {verClave ? 'visibility' : 'visibility_off'}
              </button>
            </div>
          </div>

          <div className="flex justify-end mt-3">
            <button type="button" className="text-[12px] font-semibold text-[#5D3A5F] hover:underline">
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          {error && <div className="text-danger text-[12px] mt-3">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full mt-6 bg-[#5D3A5F] text-white rounded-[10px] py-3 text-[13.5px] font-semibold hover:bg-[#74497A] transition-colors disabled:opacity-50"
          >
            {busy ? 'Ingresando…' : 'Iniciar sesión'}
          </button>

          <p className="text-center text-[11.5px] text-[#8A8375] mt-5">
            ¿Problemas para ingresar?{' '}
            <span className="text-[#5D3A5F] font-semibold">Contactá al administrador</span>
          </p>
        </form>
      </main>
    </div>
  );
}
