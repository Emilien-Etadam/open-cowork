import { useCallback, useState, type RefObject } from 'react';
import type { ContentBlock } from '../types';
import {
  createTextNoteAttachment,
  getTextByteSize,
  LONG_PASTE_MAX_BYTES,
  shouldConvertLongPaste,
} from '../../shared/long-paste';

export type AttachedFile = {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
  isTextNote?: boolean;
};

export type PastedImage = {
  url: string;
  base64: string;
  mediaType: string;
};

type NoticeType = 'info' | 'warning' | 'error';

interface UseChatAttachmentsOptions {
  isComposingRef: RefObject<boolean>;
  onNotice?: (notice: { id: string; type: NoticeType; message: string; messageKey?: string }) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const MAX_IMAGE_BLOB_SIZE = 3.75 * 1024 * 1024;

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader result is not a string'));
        return;
      }
      const parts = result.split(',');
      resolve(parts[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function resizeImageIfNeeded(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_IMAGE_BLOB_SIZE) {
    return blob;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      const scale = Math.sqrt(MAX_IMAGE_BLOB_SIZE / blob.size);
      const quality = 0.9;

      const attemptCompress = (currentScale: number, currentQuality: number): Promise<Blob> => {
        canvas.width = Math.floor(img.width * currentScale);
        canvas.height = Math.floor(img.height * currentScale);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        return new Promise((resolveBlob) => {
          canvas.toBlob(
            (compressedBlob) => {
              if (!compressedBlob) {
                reject(new Error('Failed to compress image'));
                return;
              }

              if (
                compressedBlob.size > MAX_IMAGE_BLOB_SIZE &&
                (currentQuality > 0.5 || currentScale > 0.3)
              ) {
                const newQuality = Math.max(0.5, currentQuality - 0.1);
                const newScale = currentQuality <= 0.5 ? currentScale * 0.9 : currentScale;
                attemptCompress(newScale, newQuality).then(resolveBlob);
              } else {
                resolveBlob(compressedBlob);
              }
            },
            blob.type || 'image/jpeg',
            currentQuality
          );
        });
      };

      attemptCompress(scale, quality).then(resolve).catch(reject);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

export function useChatAttachments({ isComposingRef, onNotice, t }: UseChatAttachmentsOptions) {
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const removeImage = useCallback((index: number) => {
    setPastedImages((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].url);
      updated.splice(index, 1);
      return updated;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setPastedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.url));
      return [];
    });
    setAttachedFiles([]);
  }, []);

  const addTextNoteFromPaste = useCallback(
    (text: string) => {
      const byteSize = getTextByteSize(text);
      if (byteSize > LONG_PASTE_MAX_BYTES) {
        onNotice?.({
          id: `long-paste-too-large-${Date.now()}`,
          type: 'error',
          message: t('chat.longPasteTooLarge'),
          messageKey: 'chat.longPasteTooLarge',
        });
        return;
      }

      setAttachedFiles((prev) => {
        const nextIndex = prev.filter((file) => file.isTextNote).length + 1;
        try {
          const note = createTextNoteAttachment(text, nextIndex);
          return [...prev, note];
        } catch {
          onNotice?.({
            id: `long-paste-too-large-${Date.now()}`,
            type: 'error',
            message: t('chat.longPasteTooLarge'),
            messageKey: 'chat.longPasteTooLarge',
          });
          return prev;
        }
      });

      onNotice?.({
        id: `long-paste-converted-${Date.now()}`,
        type: 'info',
        message: t('chat.longPasteConverted'),
        messageKey: 'chat.longPasteConverted',
      });
    },
    [onNotice, t]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
      if (imageItems.length > 0) {
        e.preventDefault();

        const newImages: PastedImage[] = [];

        for (const item of imageItems) {
          const blob = item.getAsFile();
          if (!blob) continue;

          try {
            const resizedBlob = await resizeImageIfNeeded(blob);
            const base64 = await blobToBase64(resizedBlob);
            const url = URL.createObjectURL(resizedBlob);
            newImages.push({
              url,
              base64,
              mediaType: resizedBlob.type,
            });
          } catch {
            onNotice?.({
              id: `image-paste-failed-${Date.now()}`,
              type: 'warning',
              message: t('chat.imageProcessFailed'),
              messageKey: 'chat.imageProcessFailed',
            });
          }
        }

        if (newImages.length > 0) {
          setPastedImages((prev) => [...prev, ...newImages]);
        }
        return;
      }

      if (isComposingRef.current) {
        return;
      }

      const pastedText = e.clipboardData.getData('text/plain');
      if (!shouldConvertLongPaste(pastedText)) {
        return;
      }

      e.preventDefault();
      addTextNoteFromPaste(pastedText);
    },
    [addTextNoteFromPaste, isComposingRef, onNotice, t]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      const otherFiles = files.filter((file) => !file.type.startsWith('image/'));

      if (imageFiles.length > 0) {
        const newImages: PastedImage[] = [];

        for (const file of imageFiles) {
          try {
            const resizedBlob = await resizeImageIfNeeded(file);
            const base64 = await blobToBase64(resizedBlob);
            const url = URL.createObjectURL(resizedBlob);
            newImages.push({
              url,
              base64,
              mediaType: resizedBlob.type,
            });
          } catch {
            onNotice?.({
              id: `image-drop-failed-${Date.now()}`,
              type: 'warning',
              message: t('chat.imageProcessFailed'),
              messageKey: 'chat.imageProcessFailed',
            });
          }
        }

        if (newImages.length > 0) {
          setPastedImages((prev) => [...prev, ...newImages]);
        }
      }

      if (otherFiles.length > 0) {
        const newFiles = await Promise.all(
          otherFiles.map(async (file) => {
            const droppedPath = 'path' in file && typeof file.path === 'string' ? file.path : '';
            const inlineDataBase64 = droppedPath ? undefined : await blobToBase64(file);

            return {
              name: file.name,
              path: droppedPath,
              size: file.size,
              type: file.type || 'application/octet-stream',
              inlineDataBase64,
            };
          })
        );

        setAttachedFiles((prev) => [...prev, ...newFiles]);
      }
    },
    [onNotice, t]
  );

  const buildContentBlocks = useCallback(
    (promptText: string): ContentBlock[] => {
      const contentBlocks: ContentBlock[] = [];

      pastedImages.forEach((img) => {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: img.base64,
          },
        });
      });

      attachedFiles.forEach((file) => {
        contentBlocks.push({
          type: 'file_attachment',
          filename: file.name,
          relativePath: file.path,
          size: file.size,
          mimeType: file.type,
          inlineDataBase64: file.inlineDataBase64,
        });
      });

      if (promptText.trim()) {
        contentBlocks.push({
          type: 'text',
          text: promptText.trim(),
        });
      }

      return contentBlocks;
    },
    [attachedFiles, pastedImages]
  );

  return {
    pastedImages,
    attachedFiles,
    setAttachedFiles,
    setPastedImages,
    isDragging,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeImage,
    removeFile,
    clearAttachments,
    buildContentBlocks,
  };
}
