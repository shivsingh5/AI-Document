const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "csv", "xlsx", "docx", "png", "jpg", "jpeg", "tif", "tiff", "bmp",
]);
const FIELD_LABELS = {
  state: "State",
  zipCode: "Zip Code",
  netIncome: "Net Income",
  entityName: "Entity name",
};

const uploadForm = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file-input");
const filePrompt = document.querySelector("#file-prompt");
const fileHint = document.querySelector("#file-hint");
const uploadButton = document.querySelector("#upload-button");
const dropzone = document.querySelector("#dropzone");
const notice = document.querySelector("#notice");
const noticeMessage = document.querySelector("#notice-message");
const documentList = document.querySelector("#document-list");
const documentCount = document.querySelector("#document-count");
const refreshButton = document.querySelector("#refresh-documents");
const detailEmpty = document.querySelector("#detail-empty");
const detailContent = document.querySelector("#document-detail-content");
const documentLabel = document.querySelector("#document-label");
const documentMeta = document.querySelector("#document-meta");
const fieldGrid = document.querySelector("#field-grid");
const downloadButton = document.querySelector("#download-button");

let selectedFile = null;
let currentDocumentId = null;
let documentListRequest = 0;
let detailRequest = 0;

function setNotice(message, kind = "info") {
  notice.hidden = !message;
  notice.className = `notice${kind === "info" ? "" : ` ${kind}`}`;
  noticeMessage.textContent = message;
}

function setBusy(button, busy, busyText) {
  button.disabled = busy;
  const label = button.querySelector("span");
  if (!label) return;
  if (busy) {
    button.dataset.originalLabel = label.textContent ?? "";
    label.textContent = busyText;
  } else {
    label.textContent = button.dataset.originalLabel ?? label.textContent ?? "";
  }
}

function getExtension(fileName) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function getDisplayType(item) {
  return (item.fileType === "image"
    ? getExtension(item.fileName)
    : item.fileType || getExtension(item.fileName)
  ).toUpperCase();
}

function selectFile(file) {
  if (!file) return;
  const extension = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    selectedFile = null;
    fileInput.value = "";
    filePrompt.innerHTML = 'Drop your file here <span>or browse</span>';
    fileHint.textContent = "That file type isn’t supported. Choose PDF, CSV, XLSX, DOCX, PNG, JPG, TIFF, or BMP.";
    uploadButton.disabled = true;
    setNotice("Choose a PDF, CSV, XLSX, DOCX, PNG, JPG, TIFF, or BMP file.", "error");
    return;
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    selectedFile = null;
    fileInput.value = "";
    uploadButton.disabled = true;
    fileHint.textContent =
      file.size === 0 ? "This file is empty." : "The file must be 10 MB or smaller.";
    setNotice(fileHint.textContent, "error");
    return;
  }

  selectedFile = file;
  filePrompt.textContent = file.name;
  fileHint.textContent = `${formatBytes(file.size)} · Ready to upload`;
  uploadButton.disabled = false;
  setNotice("");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(
      "Could not connect to the API. Check that the server is running, then try again.",
      { cause: error },
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(
      response.ok
        ? "The API returned an unreadable response."
        : `The API request failed with status ${response.status}.`,
      { cause: error },
    );
  }

  if (!response.ok || body?.success === false) {
    throw new Error(body?.message || `Request failed with status ${response.status}.`);
  }
  return body;
}

async function uploadToS3(upload, file) {
  const formData = new FormData();
  for (const [field, value] of Object.entries(upload.fields)) {
    formData.append(field, value);
  }
  formData.append("file", file);

  let response;
  try {
    response = await fetch(upload.url, {
      method: upload.method,
      body: formData,
    });
  } catch (error) {
    throw new Error(
      "Could not upload directly to S3. Check that the S3 bucket CORS policy allows this website’s origin and POST requests.",
      { cause: error },
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.text();
      const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
      if (code) detail = ` (${code})`;
    } catch {
      // The S3 status remains actionable even if its response body is unreadable.
    }
    throw new Error(
      `S3 rejected the file upload with HTTP ${response.status}${detail}. The upload form may have expired; retry to get a new one.`,
    );
  }
}

function createFieldCard(field, record) {
  const card = document.createElement("article");
  card.className = "field-card";

  const top = document.createElement("div");
  top.className = "field-card-top";

  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = FIELD_LABELS[field];

  const found = Boolean(record?.value);
  const state = document.createElement("span");
  state.className = `field-state${found ? " found" : ""}`;
  state.setAttribute("aria-label", found ? "Value found" : "Value not found");
  top.append(label, state);

  const value = document.createElement("strong");
  value.className = `field-value${found ? "" : " empty"}`;
  value.textContent = record?.value ?? "Not found";
  card.append(top, value);

  if (record?.evidence) {
    const evidence = document.createElement("p");
    evidence.className = "field-evidence";
    evidence.textContent = `“${record.evidence}”`;
    card.append(evidence);
  }
  return card;
}

function renderExtractions(records) {
  const byField = new Map(records.map((record) => [record.field, record]));
  fieldGrid.replaceChildren(
    ...Object.keys(FIELD_LABELS).map((field) =>
      createFieldCard(field, byField.get(field)),
    ),
  );
}

function renderDocumentList(documents) {
  documentCount.textContent = String(documents.length);
  if (documents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-message";
    empty.textContent = "No processed documents yet. Upload one to get started.";
    documentList.replaceChildren(empty);
    return;
  }

  const items = documents.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `document-item${item.documentId === currentDocumentId ? " selected" : ""}`;
    button.dataset.documentId = item.documentId;
    button.setAttribute("aria-current", item.documentId === currentDocumentId ? "true" : "false");
    button.addEventListener("click", () => selectDocument(item));

    const icon = document.createElement("span");
    icon.className = "document-item-icon";
    icon.textContent = getDisplayType(item);

    const copy = document.createElement("span");
    copy.className = "document-item-copy";
    const name = document.createElement("strong");
    name.textContent = item.fileName;
    const meta = document.createElement("small");
    meta.textContent = `${formatDate(item.createdAt)} · ${getDisplayType(item)}`;
    copy.append(name, meta);

    const arrow = document.createElement("span");
    arrow.className = "document-item-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    button.append(icon, copy, arrow);
    return button;
  });
  documentList.replaceChildren(...items);
}

async function loadDocuments(preferredDocumentId, updateNotice = true) {
  const requestId = ++documentListRequest;
  documentList.innerHTML = '<div class="list-message">Loading your documents…</div>';
  try {
    const response = await requestJson("/api/documents");
    if (requestId !== documentListRequest) return;
    const documents = response.data;
    if (!Array.isArray(documents)) {
      throw new Error("The document list response was invalid.");
    }

    renderDocumentList(documents);
    if (documents.length === 0) {
      currentDocumentId = null;
      detailContent.hidden = true;
      detailEmpty.hidden = false;
      if (updateNotice) setNotice("");
      return true;
    }

    const selected =
      documents.find((item) => item.documentId === preferredDocumentId) ??
      documents.find((item) => item.documentId === currentDocumentId) ??
      documents[0];
    await selectDocument(selected);
    if (updateNotice) setNotice("");
    return true;
  } catch (error) {
    if (requestId !== documentListRequest) return false;
    documentCount.textContent = "—";
    const message = document.createElement("div");
    message.className = "list-message list-message-error";
    message.textContent =
      error instanceof Error ? error.message : "Could not load documents.";
    documentList.replaceChildren(message);
    if (updateNotice) setNotice(message.textContent, "error");
    return false;
  }
}

async function selectDocument(item) {
  currentDocumentId = item.documentId;
  renderDocumentListFromCurrentSelection();
  detailEmpty.hidden = true;
  detailContent.hidden = false;
  documentLabel.textContent = item.fileName;
  documentMeta.textContent = `${getDisplayType(item)} · ${formatDate(item.createdAt)}`;
  downloadButton.disabled = false;
  fieldGrid.replaceChildren(
    ...Object.keys(FIELD_LABELS).map((field) => createFieldCard(field, null)),
  );
  const requestId = ++detailRequest;

  try {
    const response = await requestJson(
      `/api/documents/${encodeURIComponent(item.documentId)}/extractions`,
    );
    if (requestId !== detailRequest) return;
    renderExtractions(Array.isArray(response.data) ? response.data : []);
  } catch (error) {
    if (requestId !== detailRequest) return;
    fieldGrid.replaceChildren();
    const message = document.createElement("p");
    message.className = "detail-error";
    message.textContent =
      error instanceof Error ? error.message : "Could not load extracted values.";
    fieldGrid.append(message);
  }
}

function renderDocumentListFromCurrentSelection() {
  for (const item of documentList.querySelectorAll(".document-item")) {
    const selected = item.getAttribute("aria-current") === "true";
    const documentId = item.dataset.documentId;
    const isCurrent = documentId === currentDocumentId;
    item.classList.toggle("selected", isCurrent);
    item.setAttribute("aria-current", isCurrent ? "true" : "false");
    if (selected && !isCurrent) item.blur();
  }
}

fileInput.addEventListener("change", () => selectFile(fileInput.files?.[0]));

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag-over");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("drag-over");
  });
}

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
  } catch {
    selectedFile = file;
  }
  selectFile(file);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFile) return;

  setBusy(uploadButton, true, "Uploading & analyzing…");
  setNotice("Uploading, parsing, and extracting key fields. This can take a little while.");
  fileInput.disabled = true;
  refreshButton.disabled = true;

  try {
    setNotice("Preparing a secure upload to S3.");
    const presignedResponse = await requestJson("/api/documents/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: selectedFile.name }),
    });

    const upload = presignedResponse.data?.upload;
    const documentId = presignedResponse.data?.documentId;
    const fileName = presignedResponse.data?.fileName;
    if (
      typeof documentId !== "string" ||
      typeof fileName !== "string" ||
      upload?.method !== "POST" ||
      typeof upload.url !== "string" ||
      typeof upload.fields !== "object" ||
      upload.fields === null
    ) {
      throw new Error("The API returned an invalid presigned upload form.");
    }

    setNotice("Uploading your file directly to private S3 storage.");
    await uploadToS3(upload, selectedFile);

    setNotice("S3 upload complete. Processing and extracting document fields.");
    await requestJson("/api/documents/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, fileName }),
    });

    const listLoaded = await loadDocuments(documentId);
    selectedFile = null;
    fileInput.value = "";
    filePrompt.innerHTML = 'Drop your file here <span>or browse</span>';
    fileHint.textContent = "PDF, CSV, XLSX, DOCX or image (PNG, JPG, TIFF, BMP) · up to 10 MB";
    uploadButton.disabled = true;
    if (listLoaded) {
      setNotice("Document uploaded. Its extracted values are shown beside the document list.", "success");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The document could not be uploaded.";
    setNotice(message, "error");
    void loadDocuments(undefined, false);
  } finally {
    fileInput.disabled = false;
    refreshButton.disabled = false;
    setBusy(uploadButton, false);
    uploadButton.disabled = !selectedFile;
  }
});

refreshButton.addEventListener("click", () => {
  void loadDocuments();
});

downloadButton.addEventListener("click", async () => {
  if (!currentDocumentId) return;
  downloadButton.disabled = true;

  try {
    const response = await requestJson(
      `/api/documents/${encodeURIComponent(currentDocumentId)}/download-url`,
    );
    const link = document.createElement("a");
    link.href = response.data.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Could not create a temporary download link.", "error");
  } finally {
    downloadButton.disabled = false;
  }
});

void loadDocuments();
