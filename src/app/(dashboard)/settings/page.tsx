'use client';

import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { InboxSettings } from '@/components/settings/inbox-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering — shipping a settings screen whose rail never
// wires up its click handlers. You land on the section the URL carried
// (the account-menu Settings link points at `?tab=whatsapp`) and can't
// navigate away. Mirror the login/signup split: a thin wrapper supplies
// the boundary; the inner component reads the query string.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, isAgent } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const requestedSection = resolveSection(searchParams.get('tab'));
  const section = isAgent && !['profile', 'security', 'appearance'].includes(requestedSection) ? 'profile' : requestedSection;

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <><WhatsAppConfig /><WhatsAppProfilePhoto /></>,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    inbox: <InboxSettings />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pageDesc')}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}

function WhatsAppProfilePhoto() {
  const { canManageMembers } = useAuth();
  const [file,setFile] = useState<File|null>(null);
  const [busy,setBusy] = useState(false);
  if (!canManageMembers) return null;
  async function save() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const body = new FormData(); body.append('photo',file);
      const res = await fetch('/api/whatsapp/profile-photo',{method:'POST',body});
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar la foto.');
      toast.success('Foto de WhatsApp actualizada en Meta.'); setFile(null);
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Error al actualizar la foto.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-4 space-y-3 rounded-xl border border-border bg-card p-4">
    <h2 className="font-semibold">Foto de perfil de WhatsApp principal</h2>
    <p className="text-xs text-muted-foreground">Elegí una imagen JPG o PNG de hasta 5 MB. Se modificará el perfil comercial público.</p>
    <input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e=>setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
    <button type="button" disabled={!file || busy} onClick={()=>void save()} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy?'Actualizando…':'Actualizar foto'}</button>
  </section>;
}
