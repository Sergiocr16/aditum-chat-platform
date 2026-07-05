'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

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
    <div className="min-h-screen flex items-center justify-center bg-[#EFECE6] p-4 sm:p-6">
      <div className="w-full max-w-[920px] bg-white rounded-2xl shadow-[0_24px_60px_rgba(10,29,49,.18)] overflow-hidden flex min-h-[560px]">
        {/* Panel de marca (oculto en móvil) */}
        <div className="hidden md:flex w-[380px] flex-none bg-[#0A1D31] text-white flex-col p-9 relative overflow-hidden">
          <div className="absolute -right-16 -bottom-16 w-64 h-64 rounded-full bg-white/[.04]" />
          <div className="absolute -right-5 -bottom-5 w-36 h-36 rounded-full bg-white/[.05]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aditum-logo-white.png" alt="Aditum" className="h-6 w-auto self-start relative" />
          <div className="mt-auto relative">
            <div className="text-[23px] font-bold leading-tight">Consola de soporte</div>
            <p className="text-[13px] text-white/70 mt-2.5 leading-relaxed">
              Atendé las conversaciones y tickets de los administradores de condominios, con el bot de
              Claude como primera línea.
            </p>
            <div className="flex items-center gap-2 mt-6">
              <span className="w-2 h-2 rounded-full bg-[#4ADE80]" />
              <span className="text-[11.5px] text-white/60">
                Atención en tiempo real · Bot con Claude
              </span>
            </div>
          </div>
        </div>

        {/* Formulario */}
        <div className="flex-1 flex items-center justify-center p-8">
          <form onSubmit={submit} className="w-full max-w-[340px]">
            {/* logo compacto solo en móvil */}
            <span className="md:hidden inline-flex bg-[#0A1D31] rounded-xl px-4 py-3 mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/aditum-logo-white.png" alt="Aditum" className="h-6 w-auto" />
            </span>

            <div className="text-[20px] font-bold text-[#26241F]">Iniciar sesión</div>
            <div className="text-[12.5px] text-[#8A8375] mt-1.5">Ingresá con tu cuenta de Aditum</div>

            <div className="mt-6">
              <label className="block text-[11.5px] font-semibold text-[#6E675C] mb-1.5">
                Correo electrónico
              </label>
              <div className="flex items-center gap-2.5 border border-[#E4DFD6] rounded-[10px] px-3 py-[11px] bg-[#FBFAF8] focus-within:border-[#123C68] transition-colors">
                <span className="msr text-[17px] text-[#A9A294]">mail</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="lcampos@aditumcr.com"
                  className="flex-1 bg-transparent outline-none text-[13px] text-[#26241F] placeholder:text-[#B7B0A2]"
                />
              </div>
            </div>

            <div className="mt-3.5">
              <label className="block text-[11.5px] font-semibold text-[#6E675C] mb-1.5">
                Contraseña
              </label>
              <div className="flex items-center gap-2.5 border border-[#E4DFD6] rounded-[10px] px-3 py-[11px] bg-[#FBFAF8] focus-within:border-[#123C68] transition-colors">
                <span className="msr text-[17px] text-[#A9A294]">lock</span>
                <input
                  type={verClave ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="flex-1 bg-transparent outline-none text-[13px] text-[#26241F] tracking-[3px] placeholder:tracking-[3px] placeholder:text-[#B7B0A2]"
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

            <div className="flex items-center justify-between mt-3">
              <span className="text-[12px] text-[#6E675C]">Ingresá tu correo y contraseña</span>
              <button type="button" className="text-[12px] font-semibold text-[#123C68] hover:underline">
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {error && <div className="text-danger text-xs mt-3">{error}</div>}

            <button
              type="submit"
              disabled={busy}
              className="w-full mt-5 bg-[#123C68] text-white rounded-[10px] py-3 text-[13.5px] font-semibold hover:bg-[#1A4E85] transition-colors disabled:opacity-50"
            >
              {busy ? 'Ingresando…' : 'Iniciar sesión'}
            </button>

            <div className="text-center text-[11.5px] text-[#8A8375] mt-[18px]">
              ¿Problemas para ingresar?{' '}
              <span className="text-[#123C68] font-semibold">Contactá al administrador</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
