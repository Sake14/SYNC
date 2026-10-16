"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ExternalLink, Music2 } from "lucide-react";
import { musicProvidersSchema, providerResultSchema, localPlaybackSchema, zvukTrackReferenceSchema, type MusicProviderInfo } from "@sync/shared";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const providerError = "Не удалось получить состояние музыкальных сервисов. Вернуться к Local Music можно на главном экране.";
async function fetchProviderState(signal?: AbortSignal) {
  const response = await fetch("/api/music/providers", { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error("Unavailable");
  return musicProvidersSchema.parse(await response.json()).providers;
}

export function MusicServices() {
  const [providers, setProviders] = useState<MusicProviderInfo[]>([]);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      setProviders(await fetchProviderState());
      setError("");
    } catch { setError(providerError); }
  }
  useEffect(() => {
    const abort = new AbortController();
    void fetchProviderState(abort.signal).then(values => {
      if (!abort.signal.aborted) { setProviders(values); setError(""); }
    }).catch(() => { if (!abort.signal.aborted) setError(providerError); });
    return () => abort.abort();
  }, []);
  async function resolve(event: FormEvent) {
    event.preventDefault(); setLink(""); setMessage("");
    const parsed = zvukTrackReferenceSchema.safeParse(reference);
    if (!parsed.success) { setMessage("Введите ID трека или ссылку https://zvuk.com/track/…"); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/music/zvuk/tracks/${parsed.data}/playback`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      const result = providerResultSchema(localPlaybackSchema).parse(await response.json());
      if (result.status === "UNSUPPORTED" && result.officialUrl) {
        setLink(result.officialUrl);
        setMessage("Воспроизведение Звука в SYNC недоступно. Можно открыть композицию на сайте сервиса.");
      } else setMessage(result.status === "OK" ? "Воспроизведение в этом разделе недоступно." : result.message);
    } catch { setMessage("Не удалось получить ссылку. Повторите попытку."); }
    finally { setBusy(false); }
  }
  const zvuk = providers.find(provider => provider.id === "zvuk");
  return <Shell><section className="form-page music-services-page">
    <p className="eyebrow"><Music2 size={16} /> ИСТОЧНИКИ МУЗЫКИ</p>
    <h1>Ваша музыка. Ваш выбор.</h1>
    <section className="provider-card" aria-label="Local Music"><h2>Local Music</h2>
      <p>Локальные файлы, загрузки комнаты и совместное воспроизведение работают самостоятельно.</p>
      <Button asChild><Link href="/#library">Открыть локальную музыку</Link></Button>
    </section>
    <section className="provider-card" aria-label="Звук"><h2>Звук</h2>
      <p>Композицию можно открыть на официальном сайте. Авторизацию и доступ к музыке определяет сам сервис.</p>
      <p className="muted">Поиск и личная библиотека требуют отдельного разрешённого API. Вход через Сбер ID сам по себе его не предоставляет.</p>
      {zvuk && <p className="form-feedback" role="status">{zvuk.mode === "approved-metadata" ? "Подключён разрешённый адаптер метаданных." : "API каталога не подключён."} Воспроизведение в SYNC: UNSUPPORTED.</p>}
      <form onSubmit={resolve} noValidate><div className="field"><label htmlFor="zvuk-reference">Ссылка или ID композиции Звука</label>
        <Input id="zvuk-reference" value={reference} disabled={busy} maxLength={512} autoComplete="off" placeholder="https://zvuk.com/track/…" onChange={event => { setReference(event.target.value); setLink(""); setMessage(""); }} /></div>
        <Button type="submit" variant="outline" disabled={busy}>{busy ? "Проверяем способ открытия…" : "Подготовить ссылку"}</Button>
      </form>
      {message && <p className="form-feedback" role="status">{message}</p>}
      {link && <Button asChild><a href={link} target="_blank" rel="noopener noreferrer">Открыть композицию в Звуке <ExternalLink size={16} /></a></Button>}
      <p className="form-note">Ссылка не подтверждает наличие или доступность записи и не добавляет её в плеер комнаты.</p>
    </section>
    {error && <div role="alert" className="error-notice">{error}<Button variant="outline" size="sm" onClick={() => { void load(); }}>Повторить проверку сервисов</Button></div>}
  </section></Shell>;
}
