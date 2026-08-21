"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AnalysisPane } from "@/components/analysis-pane";
import { CommandPane } from "@/components/command-pane";
import { SourcesPane } from "@/components/sources-pane";
import { UploadDialog, type PendingSource } from "@/components/upload-dialog";
import {
  ApiError,
  authApi,
  getLoginPath,
  luraApi,
  type Conversation,
  type ConversationDetail,
  type FeedbackSignal,
  type MetricSnapshot,
  type ProductContextSummary,
  type ProductRelease,
  type Project,
  type User,
  type WorkspaceDocument,
} from "@/lib/api";
import { buildReleaseComparisons, groupFeedbackByTopic, seedDemoData } from "@/lib/workspace-data";

export function WorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [summary, setSummary] = useState<ProductContextSummary | null>(null);
  const [releases, setReleases] = useState<ProductRelease[]>([]);
  const [feedback, setFeedback] = useState<FeedbackSignal[]>([]);
  const [metrics, setMetrics] = useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async (projectId: string) => {
    const [loadedDocuments, loadedSummary, loadedReleases, loadedFeedback, loadedMetrics] = await Promise.all([
      luraApi.getDocuments(projectId),
      luraApi.getProductContextSummary(projectId),
      luraApi.getReleases(projectId),
      luraApi.getFeedback(projectId),
      luraApi.getMetricSnapshots(projectId),
    ]);
    setDocuments(loadedDocuments);
    setSummary(loadedSummary);
    setReleases(loadedReleases);
    setFeedback(loadedFeedback);
    setMetrics(loadedMetrics);
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
        const workspace = await luraApi.getWorkspace();
        setProject(workspace);

        const loadedConversations = await luraApi.getConversations(workspace.id);
        setConversations(loadedConversations);
        if (loadedConversations[0]) {
          setConversation(await luraApi.getConversation(loadedConversations[0].id));
        }
        await loadWorkspaceData(workspace.id);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          setError("Войдите в аккаунт, чтобы открыть рабочее пространство.");
          router.replace(getLoginPath(pathname));
          return;
        }
        setError("Не удалось загрузить рабочее пространство.");
      } finally {
        setLoading(false);
      }
    }
    void boot();
  }, [loadWorkspaceData, pathname, router]);

  async function uploadSources(sources: PendingSource[]) {
    if (!project) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const source of sources) {
        await luraApi.createDocument(project.id, source);
      }
      await loadWorkspaceData(project.id);
      setUploadOpen(false);
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : "Не удалось загрузить данные.");
    } finally {
      setUploading(false);
    }
  }

  async function removeDocument(documentId: string) {
    if (!project) return;
    setError(null);
    try {
      await luraApi.deleteDocument(documentId);
      setDocuments((current) => current.filter((document) => document.id !== documentId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить источник.");
    }
  }

  async function seed() {
    if (!project) return;
    setSeeding(true);
    setError(null);
    try {
      await seedDemoData(project.id);
      await loadWorkspaceData(project.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить демо-данные.");
    } finally {
      setSeeding(false);
    }
  }

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      router.replace("/login");
    }
  }

  const clusters = useMemo(() => groupFeedbackByTopic(feedback), [feedback]);
  const comparisons = useMemo(
    () => buildReleaseComparisons(releases, feedback, metrics),
    [releases, feedback, metrics],
  );
  const commandContext = useMemo(
    () => ({ projectName: project?.name ?? "", summary, clusters, comparisons }),
    [project?.name, summary, clusters, comparisons],
  );

  if (loading) {
    return <main className="ws-boot"><p>Открываем рабочее пространство...</p></main>;
  }
  if (!user || !project) {
    return (
      <main className="ws-boot">
        <p>{error ?? "Рабочее пространство недоступно."} <Link href="/login">Войти</Link></p>
      </main>
    );
  }

  return (
    <div className="ws">
      <header className="ws-topbar">
        <div className="ws-brand">
          <span className="ws-brand-mark">L</span>
          <span className="ws-brand-name">Lura</span>
          <span className="ws-topbar-divider" />
          <span className="ws-workspace-name">{project.name}</span>
        </div>
        <div className="ws-topbar-actions">
          <button className="ws-button ws-button-primary" onClick={() => setUploadOpen(true)}>
            Загрузить данные
          </button>
          <span className="ws-model-chip" title={`${project.skills.length} Skills · ${project.tools.length} Tools`}>
            {project.ai_model.display_name}
          </span>
          <Link className="ws-button ws-button-quiet" href="/settings/account">Аккаунт</Link>
          <button className="ws-button ws-button-quiet" onClick={logout}>Выйти</button>
        </div>
      </header>

      {error && <p className="ws-banner form-error" role="alert">{error}</p>}

      <div className="ws-body">
        <SourcesPane
          documents={documents}
          summary={summary}
          seeding={seeding}
          onUpload={() => setUploadOpen(true)}
          onSeed={() => void seed()}
          onDelete={(documentId) => void removeDocument(documentId)}
        />
        <AnalysisPane
          summary={summary}
          clusters={clusters}
          comparisons={comparisons}
          seeding={seeding}
          onSeed={() => void seed()}
        />
        <CommandPane
          project={project}
          user={user}
          initialConversations={conversations}
          initialConversation={conversation}
          context={commandContext}
          documentCount={documents.length}
        />
      </div>

      <UploadDialog
        open={uploadOpen}
        busy={uploading}
        error={uploadError}
        onClose={() => setUploadOpen(false)}
        onSubmit={(sources) => void uploadSources(sources)}
      />
    </div>
  );
}
