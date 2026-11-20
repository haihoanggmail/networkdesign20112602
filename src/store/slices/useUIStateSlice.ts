import { useCallback, useMemo, useState } from 'react';
import { DiagramNode, SelectionState } from '../../types/infrastructure';

export type CanvasTool = 'select' | 'pan' | 'connect' | 'room' | 'tray' | 'rack' | 'cable' | 'text' | 'measure';

/**
 * Isolated UI & Viewport Interaction Slice.
 * Decouples ephemeral canvas interactions (selection, tool, zoom, pan, style clipboard)
 * from structural project persistence and Undo/Redo history.
 */
export function useUIStateSlice() {
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [selection, setSelection] = useState<SelectionState>({ type: 'none' });
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [connectingSource, setConnectingSource] = useState<{ nodeId: string; portId?: string } | null>(null);
  const [deepInspectId, setDeepInspectId] = useState<string | null>(null);
  const [copiedStyle, setCopiedStyle] = useState<DiagramNode['style'] | null>(null);
  const [smartClipboardNodeIds, setSmartClipboardNodeIds] = useState<string[]>([]);

  const selectItem = useCallback((type: SelectionState['type'], id?: string, additionalIds?: string[]) => {
    setSelection({ type, id, additionalIds });
  }, []);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelection(prev => {
      if (prev.type !== 'node' || !prev.id) {
        return { type: 'node', id: nodeId };
      }
      const existing = [prev.id, ...(prev.additionalIds || [])];
      if (existing.includes(nodeId)) {
        const remaining = existing.filter(id => id !== nodeId);
        if (remaining.length === 0) return { type: 'none' };
        return { type: 'node', id: remaining[0], additionalIds: remaining.slice(1) };
      }
      return { type: 'node', id: prev.id, additionalIds: [...(prev.additionalIds || []), nodeId] };
    });
  }, []);

  const selectMultipleNodes = useCallback((nodeIds: string[]) => {
    const unique = Array.from(new Set(nodeIds));
    if (unique.length === 0) {
      setSelection({ type: 'none' });
      return;
    }
    setSelection({
      type: 'node',
      id: unique[0],
      additionalIds: unique.slice(1)
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({ type: 'none' });
  }, []);

  return useMemo(() => ({
    activeTool,
    setActiveTool,
    selection,
    setSelection,
    selectItem,
    toggleNodeSelection,
    selectMultipleNodes,
    clearSelection,
    zoom,
    setZoom,
    pan,
    setPan,
    connectingSource,
    setConnectingSource,
    deepInspectId,
    setDeepInspectId,
    copiedStyle,
    setCopiedStyle,
    smartClipboardNodeIds,
    setSmartClipboardNodeIds
  }), [
    activeTool,
    selection,
    selectItem,
    toggleNodeSelection,
    selectMultipleNodes,
    clearSelection,
    zoom,
    pan,
    connectingSource,
    deepInspectId,
    copiedStyle,
    smartClipboardNodeIds
  ]);
}
