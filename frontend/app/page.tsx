"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";
import html2canvas from "html2canvas";

type ChatItem = {
  id?: string;
  question: string;
  answer: string;
  created_at?: string;
  filename?: string | null;
};

type SheetKpiCard = {
  label: string;
  value: string | number;
};

type SheetPreview = {
  sheet_name: string;
  columns: string[];
  rows: Record<string, any>[];
  kpis?: {
    cards?: SheetKpiCard[];
    numeric_summaries?: Array<{
      column: string;
      count: number;
      sum: number;
      average: number;
      min: number;
      max: number;
    }>;
    date_summary?: Array<{
      column: string;
      min: string;
      max: string;
    }>;
    column_profiles?: Array<{
      column: string;
      dtype: string;
      non_null: number;
      nulls: number;
      unique: number;
    }>;
  };
};

type DocumentItem = {
  id?: string;
  filename: string;
  file_type?: string;
  uploaded_at?: string;
  document_type?: string | null;
  public_url?: string | null;
  storage_path?: string | null;
  extracted_data?: {
    preview?: {
      kind?: string;
      sheets?: SheetPreview[];
      workbook_kpis?: {
        cards?: SheetKpiCard[];
      };
      summary?: string;
      visible_text?: string;
      labels?: string[];
      numbers?: string[];
      table_like_content?: string;
    };
    structured_fields?: Record<string, any> | null;
    [key: string]: any;
  } | null;
};

type ConversationItem = {
  id: string;
  title: string;
  filename?: string | null;
  created_at?: string;
  updated_at?: string;
  is_public?: boolean;
  share_token?: string | null;
};


type LoanRiskForm = {
  Age: string;
  Income: string;
  LoanAmount: string;
  CreditScore: string;
  MonthsEmployed: string;
  NumCreditLines: string;
  InterestRate: string;
  LoanTerm: string;
  DTIRatio: string;
  Education: string;
  EmploymentType: string;
  MaritalStatus: string;
  HasMortgage: string;
  HasDependents: string;
  LoanPurpose: string;
  HasCoSigner: string;
};

type LoanRiskResult = {
  prediction: number;
  default_risk_probability?: number;
  risk_level?: string;
  explanation?: string;
  top_risk_drivers?: string[];
  error?: string;
};

type LoanRiskErrors = Partial<Record<keyof LoanRiskForm, string>>;

function LoadingDots() {
  return (
    <div className="flex items-center gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
    </div>
  );
}

function formatFieldLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderFieldValue(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function isSpreadsheetFile(fileType?: string | null) {
  return fileType === "csv" || fileType === "xlsx";
}

function detectActionIntent(text: string) {
  const lower = text.toLowerCase().trim();

  const wantsPdf =
    lower.includes("create pdf") ||
    lower.includes("export pdf") ||
    lower.includes("download pdf") ||
    lower.includes("download as pdf") ||
    lower.includes("pdf file") ||
    lower.includes("generate pdf");

  const wantsExcel =
    lower.includes("export excel") ||
    lower.includes("download excel") ||
    lower.includes("download as excel") ||
    lower.includes("excel file") ||
    lower.includes("xlsx") ||
    lower.includes("spreadsheet export") ||
    lower.includes("export to excel");

  const wantsDocx =
    lower.includes("create docx") ||
    lower.includes("download docx") ||
    lower.includes("export docx") ||
    lower.includes("create word") ||
    lower.includes("download word") ||
    lower.includes("word file") ||
    lower.includes("docx file");

  const wantsSnapshot =
    lower.includes("snapshot") ||
    lower.includes("dashboard image") ||
    lower.includes("download image") ||
    lower.includes("export image") ||
    lower.includes("download png") ||
    lower.includes("png");

  if (wantsPdf) return "pdf";
  if (wantsExcel) return "excel";
  if (wantsDocx) return "docx";
  if (wantsSnapshot) return "snapshot";
  return null;
}

function getSavedConversationKey(userId: string) {
  return `last_conversation_id_${userId}`;
}

function saveLastConversationId(userId: string, conversationId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(getSavedConversationKey(userId), conversationId);
}

function loadLastConversationId(userId: string) {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(getSavedConversationKey(userId)) || "";
}

function clearLastConversationId(userId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(getSavedConversationKey(userId));
}


function cleanNumericInput(value: string) {
  return value.replace(/,/g, "").trim();
}

function isPositiveNumber(value: string) {
  const cleaned = cleanNumericInput(value);
  if (cleaned === "") return false;
  const num = Number(cleaned);
  return !Number.isNaN(num) && Number.isFinite(num) && num >= 0;
}

function formatNumberForDisplay(value: string) {
  const cleaned = cleanNumericInput(value);
  if (cleaned === "" || Number.isNaN(Number(cleaned))) return value;
  return new Intl.NumberFormat("en-US").format(Number(cleaned));
}

function validateLoanRiskForm(form: LoanRiskForm): LoanRiskErrors {
  const errors: LoanRiskErrors = {};

  const numericChecks: Array<{
    key: keyof LoanRiskForm;
    label: string;
    min?: number;
    max?: number;
  }> = [
    { key: "Age", label: "Age", min: 18, max: 100 },
    { key: "Income", label: "Annual Income", min: 1, max: 10000000 },
    { key: "LoanAmount", label: "Loan Amount", min: 1, max: 100000000 },
    { key: "CreditScore", label: "Credit Score", min: 300, max: 850 },
    { key: "MonthsEmployed", label: "Months Employed", min: 0, max: 600 },
    { key: "NumCreditLines", label: "Number of Credit Lines", min: 0, max: 100 },
    { key: "InterestRate", label: "Interest Rate", min: 0, max: 100 },
    { key: "LoanTerm", label: "Loan Term", min: 1, max: 600 },
    { key: "DTIRatio", label: "Debt-to-Income Ratio", min: 0, max: 100 },
  ];

  for (const field of numericChecks) {
    const rawValue = form[field.key];
    const cleaned = cleanNumericInput(rawValue);

    if (!isPositiveNumber(cleaned)) {
      errors[field.key] = `${field.label} must be a valid non-negative number`;
      continue;
    }

    const num = Number(cleaned);

    if (field.min !== undefined && num < field.min) {
      errors[field.key] = `${field.label} must be at least ${field.min}`;
      continue;
    }

    if (field.max !== undefined && num > field.max) {
      errors[field.key] = `${field.label} must be at most ${field.max}`;
      continue;
    }
  }

  const income = Number(cleanNumericInput(form.Income));
  const loanAmount = Number(cleanNumericInput(form.LoanAmount));

  if (!errors.Income && income > 0 && income < 1000) {
    errors.Income = "Use annual income in USD, e.g. 55000";
  }

  if (!errors.LoanAmount && loanAmount > 0 && loanAmount < 1000) {
    errors.LoanAmount = "Use full loan amount in USD, e.g. 200000";
  }

  return errors;
}

function getRiskLevel(probability: number) {
  if (probability >= 0.9) return "Very High Risk 🚨";
  if (probability >= 0.7) return "High Risk ⚠️";
  if (probability >= 0.5) return "Moderate Risk";
  return "Low Risk ✅";
}

function generateRiskExplanation(form: LoanRiskForm, probability?: number) {
  const reasons: string[] = [];

  const income = Number(cleanNumericInput(form.Income));
  const loanAmount = Number(cleanNumericInput(form.LoanAmount));
  const creditScore = Number(cleanNumericInput(form.CreditScore));
  const dti = Number(cleanNumericInput(form.DTIRatio));
  const interestRate = Number(cleanNumericInput(form.InterestRate));
  const monthsEmployed = Number(cleanNumericInput(form.MonthsEmployed));

  if (dti >= 35) reasons.push("high debt-to-income ratio");
  if (interestRate >= 10) reasons.push("high interest rate");
  if (creditScore < 620) reasons.push("lower credit score");
  if (income < 40000) reasons.push("lower annual income");
  if (income > 0 && loanAmount > income * 4) reasons.push("loan amount is high compared with income");
  if (monthsEmployed < 12) reasons.push("short employment history");

  if (reasons.length === 0) {
    if ((probability || 0) < 0.5) {
      return "This application appears lower risk based on the provided income, credit, employment, and loan details.";
    }

    return "The model shows some risk, but no single input strongly stands out. Review the full borrower profile before making a decision.";
  }

  return `Risk is elevated due to ${reasons.join(", ")}.`;
}

export default function Home() {
  const { isSignedIn, user } = useUser();

  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [displayedAnswer, setDisplayedAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [sharedView, setSharedView] = useState(false);
  const [sharedTitle, setSharedTitle] = useState("");
  const [showInsights, setShowInsights] = useState(false);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<null | "pdf" | "excel" | "docx" | "snapshot">(null);

  const [history, setHistory] = useState<ChatItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedDocument, setSelectedDocument] = useState("");
  const [activeConversationId, setActiveConversationId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);


  const [loanRiskLoading, setLoanRiskLoading] = useState(false);
  const [loanRiskResult, setLoanRiskResult] = useState<LoanRiskResult | null>(null);
  const [loanRiskErrors, setLoanRiskErrors] = useState<LoanRiskErrors>({});
  const [loanRiskForm, setLoanRiskForm] = useState<LoanRiskForm>({
    Age: "35",
    Income: "55000",
    LoanAmount: "200000",
    CreditScore: "680",
    MonthsEmployed: "60",
    NumCreditLines: "5",
    InterestRate: "7.5",
    LoanTerm: "36",
    DTIRatio: "28",
    Education: "Bachelor's",
    EmploymentType: "Full-time",
    MaritalStatus: "Married",
    HasMortgage: "Yes",
    HasDependents: "Yes",
    LoanPurpose: "Home",
    HasCoSigner: "No",
  });

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const insightsRef = useRef<HTMLDivElement | null>(null);
  const exportSurfaceRef = useRef<HTMLDivElement | null>(null);

  const BACKEND_URL = "https://ai-doc-platform-24cv.onrender.com";
  const FRONTEND_URL = "https://ai-doc-platform-zeta.vercel.app";

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aTime - bTime;
    });
  }, [history]);

  const sortedDocuments = useMemo(() => {
    return [...documents].sort((a, b) => {
      const aTime = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
      const bTime = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [documents]);

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [conversations]);

  const selectedDocumentMeta = useMemo(() => {
    return documents.find((doc) => doc.filename === selectedDocument) || null;
  }, [documents, selectedDocument]);

  const spreadsheetSheets = useMemo(() => {
    return selectedDocumentMeta?.extracted_data?.preview?.sheets || [];
  }, [selectedDocumentMeta]);

  const selectedSheet = useMemo(() => {
    if (spreadsheetSheets.length === 0) return null;
    return spreadsheetSheets[selectedSheetIndex] || spreadsheetSheets[0];
  }, [spreadsheetSheets, selectedSheetIndex]);

  const structuredEntries = useMemo(() => {
    const structured = selectedDocumentMeta?.extracted_data?.structured_fields;
    if (!structured || typeof structured !== "object") return [];
    return Object.entries(structured);
  }, [selectedDocumentMeta]);

  const latestMessage = useMemo(() => {
    if (sortedHistory.length === 0) return null;
    return sortedHistory[sortedHistory.length - 1];
  }, [sortedHistory]);


  const loanRiskIsValid = useMemo(() => {
    const errors = validateLoanRiskForm(loanRiskForm);
    return Object.keys(errors).length === 0;
  }, [loanRiskForm]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const formatDate = (value?: string) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  const captureExportSurface = async (): Promise<string> => {
    await new Promise((resolve) => setTimeout(resolve, 700));

    if (!exportSurfaceRef.current) {
      console.error("Export surface is NULL");
      throw new Error("Export surface not ready");
    }

    const canvas = await html2canvas(exportSurfaceRef.current, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: true,
      removeContainer: true,
    });

    return canvas.toDataURL("image/png");
  };

  const fetchSharedConversation = async (token: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/shared/${token}`);
      const data = await res.json();

      if (res.ok) {
        setSharedView(true);
        setSharedTitle(data.conversation?.title || "Shared conversation");
        setSelectedDocument(data.conversation?.filename || "");
        setHistory(Array.isArray(data.messages) ? data.messages : []);
      }
    } catch (error) {
      console.error("Failed to fetch shared conversation:", error);
    }
  };

  const fetchDocuments = async () => {
    if (!user?.id) return [];

    try {
      const res = await fetch(`${BACKEND_URL}/documents/${user.id}`);
      const data = await res.json();

      if (res.ok) {
        const docs = Array.isArray(data) ? data : [];
        setDocuments(docs);
        return docs;
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    }

    return [];
  };

  const fetchHistory = async (conversationId: string) => {
    if (!conversationId || !user?.id) {
      setHistory([]);
      return;
    }

    try {
      const res = await fetch(
        `${BACKEND_URL}/history/${conversationId}?user_id=${encodeURIComponent(user.id)}`
      );
      const data = await res.json();

      if (res.ok) {
        setHistory(Array.isArray(data) ? data : []);
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
      setHistory([]);
    }
  };

  const fetchConversations = async (
    search?: string,
    preserveActive = true,
    preferredConversationId?: string
  ) => {
    if (!user?.id) return [];

    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);

      const qs = params.toString();
      const url = `${BACKEND_URL}/conversations/${user.id}${qs ? `?${qs}` : ""}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) return [];

      const convos = Array.isArray(data) ? data : [];
      setConversations(convos);

      if (convos.length === 0) {
        setActiveConversationId("");
        setHistory([]);
        clearLastConversationId(user.id);
        return [];
      }

      let targetConversationId = "";

      if (preferredConversationId) {
        const preferred = convos.find((c) => c.id === preferredConversationId);
        if (preferred) targetConversationId = preferred.id;
      }

      if (!targetConversationId && preserveActive && activeConversationId) {
        const existingActive = convos.find((c) => c.id === activeConversationId);
        if (existingActive) targetConversationId = existingActive.id;
      }

      if (!targetConversationId) {
        const savedConversationId = loadLastConversationId(user.id);
        if (savedConversationId) {
          const savedConversation = convos.find((c) => c.id === savedConversationId);
          if (savedConversation) targetConversationId = savedConversation.id;
        }
      }

      if (!targetConversationId) {
        targetConversationId = convos[0].id;
      }

      const targetConversation =
        convos.find((c) => c.id === targetConversationId) || convos[0];

      setActiveConversationId(targetConversation.id);
      setSelectedDocument(targetConversation.filename || "");
      saveLastConversationId(user.id, targetConversation.id);
      await fetchHistory(targetConversation.id);

      return convos;
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      return [];
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get("share");

    if (shareToken) {
      fetchSharedConversation(shareToken);
      return;
    }

    if (isSignedIn && user?.id) {
      const init = async () => {
        await fetchDocuments();
        await fetchConversations(undefined, true);
      };
      init();
    }
  }, [isSignedIn, user?.id]);

  useEffect(() => {
    scrollToBottom();
  }, [sortedHistory, displayedAnswer, loading]);

  useEffect(() => {
    setSelectedSheetIndex(0);
  }, [selectedDocument]);

  useEffect(() => {
    if (!pendingAction || loading) return;
    if (sortedHistory.length === 0) return;

    const timer = setTimeout(async () => {
      try {
        if (pendingAction === "pdf") await handleExportPdf();
        if (pendingAction === "excel") await handleExportExcel();
        if (pendingAction === "docx") await handleExportDocx();
        if (pendingAction === "snapshot") await handleDownloadSnapshot();
      } catch (e) {
        console.error("Auto export failed:", e);
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [pendingAction, loading, sortedHistory.length]);

  const createNewConversation = async (filename?: string) => {
    if (!user?.id) return null;

    try {
      const res = await fetch(`${BACKEND_URL}/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: user.id,
          title: "New Chat",
          filename: filename || null,
        }),
      });

      const data = await res.json();

      if (res.ok && data?.id) {
        const newConversation = data as ConversationItem;

        setActiveConversationId(newConversation.id);
        setSelectedDocument(newConversation.filename || filename || "");
        setHistory([]);
        setQuestion("");
        setAnswer("");
        setDisplayedAnswer("");
        setShareLink("");
        setPendingAction(null);

        saveLastConversationId(user.id, newConversation.id);

        await fetchConversations(searchText || undefined, true, newConversation.id);

        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);

        return newConversation;
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }

    return null;
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage("Please select a file.");
      return;
    }

    if (!user?.id) {
      setMessage("User not found. Please sign in again.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("user_id", user.id);

    try {
      setUploading(true);
      setMessage("Uploading, classifying, extracting, indexing, and building preview...");

      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.detail || data.error || "Upload failed");
        return;
      }

      const uploadedFilename = data.filename || file.name;
      setMessage("Upload successful.");
      setFile(null);

      await fetchDocuments();
      await fetchConversations(searchText || undefined, true);
      setSelectedDocument(uploadedFilename);
      setActiveConversationId("");
      setHistory([]);
    } catch (error) {
      console.error("Upload failed:", error);
      setMessage("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleAsk = async () => {
    if (!question.trim() || loading) return;
    if (!user?.id) return;

    if (!selectedDocument) {
      setAnswer("Please select a document first.");
      return;
    }

    let conversationId = activeConversationId;

    if (!conversationId) {
      const createdConversation = await createNewConversation(selectedDocument);
      if (!createdConversation?.id) {
        setAnswer("Failed to create a new conversation.");
        return;
      }
      conversationId = createdConversation.id;
    }

    const currentQuestion = question.trim();
    const detectedAction = detectActionIntent(currentQuestion);
    setPendingAction(detectedAction);

    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");

    const tempQuestion: ChatItem = {
      question: currentQuestion,
      answer: "",
      created_at: new Date().toISOString(),
      filename: selectedDocument || null,
    };

    try {
      setLoading(true);
      setHistory((prev) => [...prev, tempQuestion]);

      const res = await fetch(`${BACKEND_URL}/ask-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
          user_id: user.id,
          conversation_id: conversationId,
          filename: selectedDocument,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const errorMessage =
          errorData?.detail || errorData?.error || "Error getting response";

        setHistory((prev) =>
          prev.map((item, index) =>
            index === prev.length - 1 ? { ...item, answer: errorMessage } : item
          )
        );
        setAnswer(errorMessage);
        return;
      }

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");

      let finalText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventChunk of events) {
          const lines = eventChunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.replace("data: ", "").trim();

            try {
              const data = JSON.parse(jsonStr);

              if (data.token) {
                finalText += data.token;
                setAnswer(finalText);
                setDisplayedAnswer(finalText);

                setHistory((prev) =>
                  prev.map((item, index) =>
                    index === prev.length - 1 ? { ...item, answer: finalText } : item
                  )
                );
              }

              if (data.done) {
                if (data.conversation_id) {
                  setActiveConversationId(data.conversation_id);
                  saveLastConversationId(user.id, data.conversation_id);
                }
                await fetchHistory(conversationId);
                await fetchConversations(searchText || undefined, true, conversationId);
              }
            } catch (e) {
              console.error("Stream parse error:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Streaming error:", error);

      const errorMessage = "Error getting response";

      setHistory((prev) =>
        prev.map((item, index) =>
          index === prev.length - 1 ? { ...item, answer: errorMessage } : item
        )
      );
      setAnswer(errorMessage);
    } finally {
      setLoading(false);
    }
  };



  const handleLoanRiskNumberChange = (field: keyof LoanRiskForm, value: string) => {
    const cleaned = value.replace(/[^\d.]/g, "");
    setLoanRiskForm((prev) => ({
      ...prev,
      [field]: cleaned,
    }));

    setLoanRiskErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleLoanRiskSelectChange = (field: keyof LoanRiskForm, value: string) => {
    setLoanRiskForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleLoanRiskNumberBlur = (field: keyof LoanRiskForm) => {
    const value = loanRiskForm[field];
    const cleaned = cleanNumericInput(value);

    if (cleaned === "" || Number.isNaN(Number(cleaned))) return;

    if (field === "Income" || field === "LoanAmount") {
      setLoanRiskForm((prev) => ({
        ...prev,
        [field]: formatNumberForDisplay(cleaned),
      }));
    }
  };

  const handleLoanRiskPredict = async () => {
    try {
      const errors = validateLoanRiskForm(loanRiskForm);
      setLoanRiskErrors(errors);

      if (Object.keys(errors).length > 0) {
        setLoanRiskResult({
          prediction: -1,
          error: "Please fix the highlighted fields before predicting.",
        });
        return;
      }

      setLoanRiskLoading(true);
      setLoanRiskResult(null);

      const payload = {
        Age: Number(cleanNumericInput(loanRiskForm.Age)),
        Income: Number(cleanNumericInput(loanRiskForm.Income)),
        LoanAmount: Number(cleanNumericInput(loanRiskForm.LoanAmount)),
        CreditScore: Number(cleanNumericInput(loanRiskForm.CreditScore)),
        MonthsEmployed: Number(cleanNumericInput(loanRiskForm.MonthsEmployed)),
        NumCreditLines: Number(cleanNumericInput(loanRiskForm.NumCreditLines)),
        InterestRate: Number(cleanNumericInput(loanRiskForm.InterestRate)),
        LoanTerm: Number(cleanNumericInput(loanRiskForm.LoanTerm)),
        DTIRatio: Number(cleanNumericInput(loanRiskForm.DTIRatio)),
        Education: loanRiskForm.Education,
        EmploymentType: loanRiskForm.EmploymentType,
        MaritalStatus: loanRiskForm.MaritalStatus,
        HasMortgage: loanRiskForm.HasMortgage,
        HasDependents: loanRiskForm.HasDependents,
        LoanPurpose: loanRiskForm.LoanPurpose,
        HasCoSigner: loanRiskForm.HasCoSigner,
      };

      const res = await fetch(`${BACKEND_URL}/loan-risk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoanRiskResult({
          prediction: -1,
          error: data?.detail || data?.error || "Prediction failed",
        });
        return;
      }

      setLoanRiskResult(data);
    } catch (error) {
      console.error("Loan risk prediction failed:", error);
      setLoanRiskResult({
        prediction: -1,
        error: "Loan risk prediction failed",
      });
    } finally {
      setLoanRiskLoading(false);
    }
  };

  const handleSelectConversation = async (conversation: ConversationItem) => {
    setActiveConversationId(conversation.id);
    setSelectedDocument(conversation.filename || "");
    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");
    setShareLink("");
    setPendingAction(null);
    saveLastConversationId(user!.id, conversation.id);
    await fetchHistory(conversation.id);
  };

  const handleDocumentChange = async (filename: string) => {
    setSelectedDocument(filename);
    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");
    setShareLink("");
    setPendingAction(null);
    setSelectedSheetIndex(0);

    if (!filename || !user?.id) {
      setActiveConversationId("");
      setHistory([]);
      return;
    }

    try {
      const allConvos = await fetchConversations(searchText || undefined, true);

      const relatedConvos = allConvos.filter(
        (conversation: ConversationItem) => conversation.filename === filename
      );

      if (relatedConvos.length === 0) {
        setActiveConversationId("");
        setHistory([]);
        return;
      }

      const sorted = [...relatedConvos].sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bTime - aTime;
      });

      const latest = sorted[0];

      setActiveConversationId(latest.id);
      saveLastConversationId(user.id, latest.id);
      await fetchHistory(latest.id);
    } catch (error) {
      console.error("Chat history load failed:", error);
      setActiveConversationId("");
      setHistory([]);
    }
  };

  const handleNewChat = async () => {
    if (!selectedDocument) {
      alert("Please select a document first.");
      return;
    }

    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");
    setShareLink("");
    setPendingAction(null);

    const created = await createNewConversation(selectedDocument);

    if (created?.id && user?.id) {
      saveLastConversationId(user.id, created.id);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await fetch(`${BACKEND_URL}/conversations/${conversationId}`, {
        method: "DELETE",
      });

      const updatedConvos = await fetchConversations(searchText || undefined, false);

      if (user?.id) {
        const currentSaved = loadLastConversationId(user.id);
        if (currentSaved === conversationId) {
          if (updatedConvos.length > 0) {
            saveLastConversationId(user.id, updatedConvos[0].id);
          } else {
            clearLastConversationId(user.id);
          }
        }
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const handleRenameConversation = async (conversationId: string) => {
    const title = renameValue.trim();
    if (!title) return;

    try {
      const res = await fetch(`${BACKEND_URL}/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      if (res.ok) {
        setRenamingConversationId("");
        setRenameValue("");
        await fetchConversations(searchText || undefined, true, activeConversationId);
      }
    } catch (error) {
      console.error("Failed to rename conversation:", error);
    }
  };

  const handleShareConversation = async (conversationId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/conversations/${conversationId}/share`, {
        method: "POST",
      });
      const data = await res.json();

      if (res.ok && data?.share_path) {
        const fullUrl = `${FRONTEND_URL}/${data.share_path}`;
        setShareLink(fullUrl);

        try {
          await navigator.clipboard.writeText(fullUrl);
          alert("Share link copied to clipboard");
        } catch {
          alert(`Share link: ${fullUrl}`);
        }
      }
    } catch (error) {
      console.error("Failed to share conversation:", error);
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedDocument || !user?.id) return;

    const confirmed = window.confirm(
      `Delete "${selectedDocument}" and all chats linked to it?`
    );

    if (!confirmed) return;

    try {
      const deletedDocument = selectedDocument;
      const encodedFilename = encodeURIComponent(deletedDocument);

      const res = await fetch(`${BACKEND_URL}/documents/${user.id}/${encodedFilename}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const docs = await fetchDocuments();
        const remainingDocs = (docs || []).filter(
          (d: DocumentItem) => d.filename !== deletedDocument
        );

        await fetchConversations(searchText || undefined, false);

        if (remainingDocs.length > 0) {
          setSelectedDocument(remainingDocs[0].filename);
        } else {
          setSelectedDocument("");
          setConversations([]);
          setHistory([]);
          setActiveConversationId("");
          clearLastConversationId(user.id);
        }
      }
    } catch (error) {
      console.error("Failed to delete document:", error);
    }
  };

  const handleExportExcel = async () => {
    if (!user?.id || !selectedDocument) return;

    const res = await fetch(`${BACKEND_URL}/export-excel-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: selectedDocument,
        user_id: user.id,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.detail || "Failed to export Excel");
      return;
    }

    const blob = await res.blob();
    const baseName = selectedDocument.includes(".")
      ? selectedDocument.substring(0, selectedDocument.lastIndexOf("."))
      : selectedDocument;

    downloadBlob(blob, `${baseName}_report.xlsx`);
  };

  const handleExportPdf = async () => {
    if (!user?.id || !selectedDocument) return;

    const res = await fetch(`${BACKEND_URL}/export-pdf-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: selectedDocument,
        user_id: user.id,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.detail || "Failed to export PDF");
      return;
    }

    const blob = await res.blob();
    const baseName = selectedDocument.includes(".")
      ? selectedDocument.substring(0, selectedDocument.lastIndexOf("."))
      : selectedDocument;

    downloadBlob(blob, `${baseName}_report.pdf`);
  };

  const handleExportDocx = async () => {
    if (!user?.id || !selectedDocument || sortedHistory.length === 0) {
      alert("Ask at least one question before exporting DOCX");
      return;
    }

    try {
      let snapshotBase64: string | null = null;

      try {
        snapshotBase64 = await captureExportSurface();
      } catch (snapshotError) {
        console.error("Snapshot capture failed, continuing without image:", snapshotError);
      }

      const res = await fetch(`${BACKEND_URL}/export-docx-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: selectedDocument,
          user_id: user.id,
          conversation_id: activeConversationId || null,
          snapshot_base64: snapshotBase64,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.detail || "Failed to export DOCX");
        return;
      }

      const blob = await res.blob();
      const baseName = selectedDocument.includes(".")
        ? selectedDocument.substring(0, selectedDocument.lastIndexOf("."))
        : selectedDocument;

      downloadBlob(blob, `${baseName}_report.docx`);
    } catch (error) {
      console.error("DOCX export failed:", error);
      alert("Failed to export DOCX");
    }
  };

  const handleDownloadSnapshot = async () => {
    if (!selectedDocument || sortedHistory.length === 0) {
      alert("Ask at least one question before exporting snapshot");
      return;
    }

    try {
      const snapshotBase64 = await captureExportSurface();
      const response = await fetch(snapshotBase64);
      const blob = await response.blob();

      const baseName = selectedDocument.includes(".")
        ? selectedDocument.substring(0, selectedDocument.lastIndexOf("."))
        : selectedDocument;

      downloadBlob(blob, `${baseName}_dashboard.png`);
    } catch (error) {
      console.error("Snapshot export failed:", error);
      alert("Failed to export snapshot");
    }
  };



  const renderLoanInput = (
    field: keyof LoanRiskForm,
    label: string,
    placeholder: string,
    helperText?: string,
    error?: string
  ) => (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-gray-600">
        {label}
      </label>

      <input
        value={loanRiskForm[field]}
        onChange={(e) => handleLoanRiskNumberChange(field, e.target.value)}
        onBlur={() => handleLoanRiskNumberBlur(field)}
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-white p-2 text-xs ${
          error ? "border-red-400" : "border-gray-200"
        }`}
      />

      {helperText && !error && (
        <p className="mt-1 text-[11px] text-gray-500">{helperText}</p>
      )}

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );

  if (sharedView) {
    return (
      <main className="min-h-screen bg-[#f7f7f8] text-gray-900">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold">{sharedTitle}</h1>
            <p className="mt-2 text-sm text-gray-500">Shared conversation</p>
            {selectedDocument && (
              <p className="mt-1 text-sm text-gray-500">File: {selectedDocument}</p>
            )}
          </div>

          <div className="space-y-6">
            {sortedHistory.map((item, index) => (
              <div key={item.id || `${item.question}-${index}`} className="space-y-4">
                <div className="flex justify-end">
                  <div className="max-w-[75%] rounded-3xl bg-black px-5 py-4 text-white">
                    <p className="whitespace-pre-wrap text-sm leading-6">{item.question}</p>
                  </div>
                </div>

                <div className="flex justify-start">
                  <div className="max-w-[92%] rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                      AI
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                      {item.answer}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                      {item.created_at && <span>{formatDate(item.created_at)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen bg-[#f7f7f8] text-gray-900">
      {!isSignedIn ? (
        <div className="flex h-screen items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="mb-2 text-2xl font-bold">AI Document Platform</h1>
            <p className="mb-6 text-gray-600">
              Sign in to upload documents and chat with your files.
            </p>

            <div className="flex gap-3">
              <Link
                href="/sign-in"
                className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-center hover:bg-gray-50"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="flex-1 rounded-lg bg-black px-4 py-2 text-center text-white hover:bg-gray-800"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-screen">
          {sidebarOpen && (
            <aside className="flex w-[340px] flex-col overflow-y-auto border-r border-gray-200 bg-white p-3">
              <div className="mb-3">
                <button
                  onClick={handleNewChat}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm hover:bg-gray-50"
                >
                  + New chat
                </button>
              </div>

              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-sm font-medium text-gray-800">Upload file</p>

                <input
                  type="file"
                  accept=".pdf,.csv,.txt,.docx,.xlsx,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="mb-3 w-full text-xs text-gray-700"
                />

                <div className="flex gap-2">
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800 disabled:opacity-70"
                  >
                    {uploading ? "Uploading..." : "Upload"}
                  </button>

                  <button
                    onClick={() => {
                      setFile(null);
                      setMessage("");
                    }}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs hover:bg-gray-100"
                  >
                    Clear
                  </button>
                </div>

                {message && <p className="mt-3 text-xs text-gray-600">{message}</p>}
              </div>

              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <label className="mb-2 block text-sm font-medium text-gray-800">
                  Current document for new chat
                </label>
                <select
                  value={selectedDocument}
                  onChange={(e) => handleDocumentChange(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-gray-200 bg-white p-2.5 text-xs text-gray-900"
                >
                  {sortedDocuments.length === 0 ? (
                    <option value="">No documents uploaded</option>
                  ) : (
                    <>
                      <option value="">Select a document</option>
                      {sortedDocuments.map((doc, index) => (
                        <option key={doc.id || `${doc.filename}-${index}`} value={doc.filename}>
                          {doc.filename}
                        </option>
                      ))}
                    </>
                  )}
                </select>

                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteDocument}
                    disabled={!selectedDocument}
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete document
                  </button>
                </div>
              </div>

              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchText}
                  onChange={async (e) => {
                    const value = e.target.value;
                    setSearchText(value);
                    await fetchConversations(value || undefined, false);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm text-gray-900 outline-none"
                />
              </div>

              <div className="mb-2 text-sm font-medium text-gray-800">All chats</div>

              <div className="max-h-[260px] min-h-[160px] space-y-2 overflow-y-auto pr-1">
                {sortedConversations.length === 0 ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                    No chats yet
                  </div>
                ) : (
                  sortedConversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={`rounded-xl border p-3 transition ${
                        activeConversationId === conversation.id
                          ? "border-black bg-black text-white"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      {renamingConversationId === conversation.id ? (
                        <div className="space-y-2">
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm text-black outline-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRenameConversation(conversation.id)}
                              className="rounded-lg bg-white px-2 py-1 text-xs text-black"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setRenamingConversationId("");
                                setRenameValue("");
                              }}
                              className="rounded-lg bg-white px-2 py-1 text-xs text-black"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleSelectConversation(conversation)}
                            className="w-full text-left"
                          >
                            <p className="truncate text-sm font-medium">
                              {conversation.title || "New Chat"}
                            </p>
                            <p
                              className={`mt-1 truncate text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300"
                                  : "text-gray-500"
                              }`}
                            >
                              {conversation.filename || "No document selected"}
                            </p>
                          </button>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                setRenamingConversationId(conversation.id);
                                setRenameValue(conversation.title || "");
                              }}
                              className={`text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300 hover:text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              Rename
                            </button>

                            <button
                              onClick={() => handleShareConversation(conversation.id)}
                              className={`text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300 hover:text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              Share
                            </button>

                            <button
                              onClick={() => handleDeleteConversation(conversation.id)}
                              className={`text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300 hover:text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <button
                  onClick={() => setShowInsights((prev) => !prev)}
                  className="flex w-full items-center justify-between text-sm font-medium text-gray-800"
                >
                  <span>Document Insights</span>
                  <span>{showInsights ? "Hide" : "Show"}</span>
                </button>

                {showInsights && (
                  <div className="mt-3" ref={insightsRef}>
                    {!selectedDocumentMeta ? (
                      <p className="text-xs text-gray-500">Select a document to see insights.</p>
                    ) : (
                      <div className="space-y-4 text-xs">
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="mb-2 text-sm font-medium text-gray-800">
                            Client-ready exports
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={handleExportExcel}
                              disabled={!selectedDocument}
                              className="rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
                            >
                              Download Excel
                            </button>

                            <button
                              onClick={handleExportPdf}
                              disabled={!selectedDocument}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
                            >
                              Download PDF
                            </button>

                            <button
                              onClick={handleExportDocx}
                              disabled={!selectedDocument}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
                            >
                              Download DOCX
                            </button>

                            <button
                              onClick={handleDownloadSnapshot}
                              disabled={!selectedDocument}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
                            >
                              Download Snapshot
                            </button>
                          </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="mb-2 font-medium text-gray-800">Document info</div>
                          <div className="space-y-1">
                            <p>
                              <span className="font-medium">Filename:</span>{" "}
                              {selectedDocumentMeta.filename}
                            </p>
                            <p>
                              <span className="font-medium">Type:</span>{" "}
                              {selectedDocumentMeta.file_type || "—"}
                            </p>
                            <p>
                              <span className="font-medium">Document Type:</span>{" "}
                              {selectedDocumentMeta.document_type || "—"}
                            </p>
                            <p>
                              <span className="font-medium">Uploaded:</span>{" "}
                              {formatDate(selectedDocumentMeta.uploaded_at)}
                            </p>
                          </div>
                        </div>

                        {isSpreadsheetFile(selectedDocumentMeta.file_type) && (
                          <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-2 font-medium text-gray-800">Workbook preview</div>

                            {spreadsheetSheets.length > 0 && (
                              <select
                                value={selectedSheetIndex}
                                onChange={(e) => setSelectedSheetIndex(Number(e.target.value))}
                                className="mb-3 w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                              >
                                {spreadsheetSheets.map((sheet, index) => (
                                  <option key={`${sheet.sheet_name}-${index}`} value={index}>
                                    {sheet.sheet_name}
                                  </option>
                                ))}
                              </select>
                            )}

                            {selectedSheet?.kpis?.cards?.length ? (
                              <div className="mb-3 grid grid-cols-2 gap-2">
                                {selectedSheet.kpis.cards.slice(0, 6).map((card, idx) => (
                                  <div
                                    key={`${card.label}-${idx}`}
                                    className="rounded-md border border-gray-200 bg-gray-50 p-2"
                                  >
                                    <p className="text-[11px] text-gray-500">{card.label}</p>
                                    <p className="font-semibold text-gray-800">{card.value}</p>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}

                        {!isSpreadsheetFile(selectedDocumentMeta.file_type) && (
                          <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-2 font-medium text-gray-800">Summary</div>
                            <p className="whitespace-pre-wrap text-gray-700">
                              {selectedDocumentMeta.extracted_data?.preview?.summary ||
                                "No summary available"}
                            </p>
                          </div>
                        )}

                        {structuredEntries.length > 0 && (
                          <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-2 font-medium text-gray-800">Structured fields</div>
                            <div className="space-y-2">
                              {structuredEntries.slice(0, 12).map(([key, value]) => (
                                <div
                                  key={key}
                                  className="rounded-md border border-gray-200 bg-gray-50 p-2"
                                >
                                  <p className="text-[11px] font-medium text-gray-500">
                                    {formatFieldLabel(key)}
                                  </p>
                                  <p className="whitespace-pre-wrap text-gray-800">
                                    {renderFieldValue(value)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>


              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="mb-3 text-sm font-medium text-gray-800">
                  Loan Risk Predictor
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {renderLoanInput("Age", "Age (years)", "e.g. 35", undefined, loanRiskErrors.Age)}
                  {renderLoanInput(
                    "Income",
                    "Annual Income (USD)",
                    "e.g. 55000",
                    "Use yearly income, not monthly",
                    loanRiskErrors.Income
                  )}
                  {renderLoanInput(
                    "LoanAmount",
                    "Loan Amount (USD)",
                    "e.g. 200000",
                    "Enter full loan value in USD",
                    loanRiskErrors.LoanAmount
                  )}
                  {renderLoanInput(
                    "CreditScore",
                    "Credit Score (300–850)",
                    "e.g. 680",
                    undefined,
                    loanRiskErrors.CreditScore
                  )}
                  {renderLoanInput(
                    "MonthsEmployed",
                    "Months Employed",
                    "e.g. 60",
                    "Total months at current job",
                    loanRiskErrors.MonthsEmployed
                  )}
                  {renderLoanInput(
                    "NumCreditLines",
                    "Number of Credit Lines",
                    "e.g. 5",
                    undefined,
                    loanRiskErrors.NumCreditLines
                  )}
                  {renderLoanInput(
                    "InterestRate",
                    "Interest Rate (%)",
                    "e.g. 7.5",
                    "Enter percentage value",
                    loanRiskErrors.InterestRate
                  )}
                  {renderLoanInput(
                    "LoanTerm",
                    "Loan Term (Months)",
                    "e.g. 36",
                    "Total duration of loan",
                    loanRiskErrors.LoanTerm
                  )}
                </div>

                <div className="mt-2">
                  {renderLoanInput(
                    "DTIRatio",
                    "Debt-to-Income Ratio (%)",
                    "e.g. 28",
                    "Monthly debt vs income percentage",
                    loanRiskErrors.DTIRatio
                  )}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">
                      Education Level
                    </label>
                    <select
                      value={loanRiskForm.Education}
                      onChange={(e) => handleLoanRiskSelectChange("Education", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                    >
                      <option>High School</option>
                      <option>Bachelor's</option>
                      <option>Master's</option>
                      <option>PhD</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">
                      Employment Type
                    </label>
                    <select
                      value={loanRiskForm.EmploymentType}
                      onChange={(e) => handleLoanRiskSelectChange("EmploymentType", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                    >
                      <option>Full-time</option>
                      <option>Part-time</option>
                      <option>Self-employed</option>
                      <option>Unemployed</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">
                      Marital Status
                    </label>
                    <select
                      value={loanRiskForm.MaritalStatus}
                      onChange={(e) => handleLoanRiskSelectChange("MaritalStatus", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                    >
                      <option>Single</option>
                      <option>Married</option>
                      <option>Divorced</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">
                      Has Mortgage?
                    </label>
                    <select
                      value={loanRiskForm.HasMortgage}
                      onChange={(e) => handleLoanRiskSelectChange("HasMortgage", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                    >
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">
                      Has Dependents?
                    </label>
                    <select
                      value={loanRiskForm.HasDependents}
                      onChange={(e) => handleLoanRiskSelectChange("HasDependents", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                    >
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">
                      Has Co-Signer?
                    </label>
                    <select
                      value={loanRiskForm.HasCoSigner}
                      onChange={(e) => handleLoanRiskSelectChange("HasCoSigner", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                    >
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                  </div>
                </div>

                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-medium text-gray-600">
                    Loan Purpose
                  </label>
                  <select
                    value={loanRiskForm.LoanPurpose}
                    onChange={(e) => handleLoanRiskSelectChange("LoanPurpose", e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
                  >
                    <option>Home</option>
                    <option>Business</option>
                    <option>Education</option>
                    <option>Auto</option>
                    <option>Other</option>
                  </select>
                </div>

                <button
                  onClick={handleLoanRiskPredict}
                  disabled={loanRiskLoading || !loanRiskIsValid}
                  className="mt-3 w-full rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {loanRiskLoading ? "Predicting..." : "Predict Loan Risk"}
                </button>

                {loanRiskResult && (
  <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-xs">
    {loanRiskResult.error ? (
      <p className="text-red-600">{loanRiskResult.error}</p>
    ) : (
      <div className="space-y-2">
        <p>
          <span className="font-medium">Prediction:</span>{" "}
          {loanRiskResult.prediction === 1 ? "Default Risk" : "Low Risk"}
        </p>

        {typeof loanRiskResult.default_risk_probability === "number" && (
          <p>
            <span className="font-medium">Probability:</span>{" "}
            {(loanRiskResult.default_risk_probability * 100).toFixed(2)}%
          </p>
        )}

        <p>
          <span className="font-medium">Risk Level:</span>{" "}
          {loanRiskResult.risk_level ||
            getRiskLevel(loanRiskResult.default_risk_probability || 0)}
        </p>

        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <p className="mb-1 font-medium text-gray-700">Why this result?</p>
          <p className="text-gray-600">
            {loanRiskResult.explanation ||
              generateRiskExplanation(
                loanRiskForm,
                loanRiskResult.default_risk_probability
              )}
          </p>
        </div>

        {loanRiskResult.top_risk_drivers?.length ? (
          <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2">
            <p className="mb-1 font-medium text-gray-700">Top Risk Drivers:</p>
            <ul className="list-disc space-y-1 pl-4 text-gray-600">
              {loanRiskResult.top_risk_drivers.map((driver, index) => (
                <li key={index}>{driver}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )}
  </div>
)}
              </div>

            </aside>
          )}

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                {!sidebarOpen && (
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-100"
                  >
                    ☰
                  </button>
                )}

                <div>
                  <h1 className="text-lg font-semibold">AI Document Platform</h1>
                  <p className="text-xs text-gray-500">
                    {selectedDocument ? `Current file: ${selectedDocument}` : "No file selected"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSidebarOpen((prev) => !prev)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-100"
                >
                  {sidebarOpen ? "Hide panel" : "Show panel"}
                </button>
                <UserButton />
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
                {shareLink && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                    Share link copied:
                    <div className="mt-2 break-all text-xs text-gray-500">{shareLink}</div>
                  </div>
                )}

                {sortedHistory.length === 0 && !loading && !displayedAnswer && (
                  <div className="mt-20 text-center">
                    <h2 className="mb-3 text-4xl font-semibold text-gray-900">
                      Ask your document anything
                    </h2>
                    <p className="text-gray-500">
                      {selectedDocument
                        ? activeConversationId
                          ? "This conversation is empty. Ask your first question."
                          : "Choose New chat to start with the selected document, or open any previous chat from the sidebar."
                        : "Select a document for a new chat, or open a previous chat from the sidebar."}
                    </p>
                  </div>
                )}

                {sortedHistory.map((item, index) => (
                  <div key={item.id || `${item.question}-${index}`} className="space-y-4">
                    <div className="flex justify-end">
                      <div className="max-w-[75%] rounded-3xl bg-black px-5 py-4 text-white">
                        <p className="whitespace-pre-wrap text-sm leading-6">{item.question}</p>
                      </div>
                    </div>

                    <div className="flex justify-start">
                      <div className="max-w-[92%] rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                          AI
                        </p>

                        <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                          {item.answer}
                        </p>

                        {index === sortedHistory.length - 1 && pendingAction && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {pendingAction === "pdf" && (
                              <button
                                onClick={handleExportPdf}
                                className="rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800"
                              >
                                Download PDF
                              </button>
                            )}

                            {pendingAction === "excel" && (
                              <button
                                onClick={handleExportExcel}
                                className="rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800"
                              >
                                Download Excel
                              </button>
                            )}

                            {pendingAction === "docx" && (
                              <button
                                onClick={handleExportDocx}
                                className="rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800"
                              >
                                Download DOCX
                              </button>
                            )}

                            {pendingAction === "snapshot" && (
                              <button
                                onClick={handleDownloadSnapshot}
                                className="rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800"
                              >
                                Download Snapshot
                              </button>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                          {item.created_at && <span>{formatDate(item.created_at)}</span>}
                          {item.filename && <span>{item.filename}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                        AI
                      </p>
                      <LoadingDots />
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </div>

            <div className="border-t border-gray-200 bg-white px-4 py-4">
              <div className="mx-auto max-w-5xl">
                <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
                  <textarea
                    ref={inputRef}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleAsk();
                      }
                    }}
                    placeholder="Ask something about your document..."
                    rows={3}
                    className="w-full resize-none border-0 bg-transparent text-sm outline-none"
                  />

                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {selectedDocument
                        ? `Selected: ${selectedDocument}`
                        : "Select a document to start"}
                    </p>

                    <button
                      onClick={handleAsk}
                      disabled={loading || !question.trim()}
                      className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {loading ? "Thinking..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div
            style={{
              position: "fixed",
              left: "-10000px",
              top: 0,
              width: "960px",
              background: "#ffffff",
              zIndex: -1,
              padding: "24px",
            }}
          >
            <div
              ref={exportSurfaceRef}
              style={{ minHeight: "400px" }}
              className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-900"
            >
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold">AI Document Report</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Snapshot generated from the current conversation and document insights
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <div>{selectedDocument || "No document selected"}</div>
                  <div>{activeConversationId || "No active conversation"}</div>
                </div>
              </div>

              {selectedDocumentMeta && (
                <div className="mb-6 grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs text-gray-500">File Type</div>
                    <div className="mt-1 text-lg font-semibold">
                      {selectedDocumentMeta.file_type || "—"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs text-gray-500">Document Type</div>
                    <div className="mt-1 text-lg font-semibold">
                      {selectedDocumentMeta.document_type || "—"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs text-gray-500">Messages</div>
                    <div className="mt-1 text-lg font-semibold">{sortedHistory.length}</div>
                  </div>
                </div>
              )}

              {isSpreadsheetFile(selectedDocumentMeta?.file_type) &&
              selectedSheet?.kpis?.cards?.length ? (
                <div className="mb-6">
                  <h3 className="mb-3 text-lg font-semibold">Spreadsheet KPIs</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {selectedSheet.kpis.cards.slice(0, 6).map((card, idx) => (
                      <div
                        key={`${card.label}-${idx}`}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <div className="text-xs text-gray-500">{card.label}</div>
                        <div className="mt-1 text-xl font-semibold">{card.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!isSpreadsheetFile(selectedDocumentMeta?.file_type) &&
              selectedDocumentMeta?.extracted_data?.preview?.summary ? (
                <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <h3 className="mb-2 text-lg font-semibold">Summary</h3>
                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                    {selectedDocumentMeta.extracted_data.preview.summary}
                  </p>
                </div>
              ) : null}

              {latestMessage && (
                <div className="mb-6">
                  <h3 className="mb-3 text-lg font-semibold">Latest Q&A</h3>
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-black p-4 text-white">
                      <div className="mb-1 text-xs uppercase tracking-wide text-gray-300">
                        Question
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{latestMessage.question}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">
                        Answer
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-gray-800">
                        {latestMessage.answer}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {structuredEntries.length > 0 && (
                <div>
                  <h3 className="mb-3 text-lg font-semibold">Structured Fields</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {structuredEntries.slice(0, 8).map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                      >
                        <div className="text-xs text-gray-500">{formatFieldLabel(key)}</div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                          {renderFieldValue(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}