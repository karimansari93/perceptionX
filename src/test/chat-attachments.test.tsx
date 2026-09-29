// Ask PerceptionX file attachments: which files are accepted, and the
// composer's attach / remove / send flow.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  addFiles, contentTypeFor, DEFAULT_FILE_QUESTION, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, storageSafeName,
} from '@/lib/chatAttachments';
import { ChatWelcome } from '@/components/chat/ChatWelcome';
import { EMPTY_SCOPE } from '@/services/chatService';

const file = (name: string, size = 10, type = '') => {
  const f = new File(['x'.repeat(Math.min(size, 10))], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('chat attachment rules', () => {
  it('stores files under the type their extension names', () => {
    expect(contentTypeFor('Survey.PDF')).toBe('application/pdf');
    expect(contentTypeFor('export.csv')).toBe('text/csv');
    expect(contentTypeFor('q2.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(contentTypeFor('notes.docx')).toBeNull();
  });

  it('accepts PDF, Excel and CSV within the limits and explains the rest', () => {
    const { files, errors } = addFiles([], [
      file('a.pdf'), file('b.xlsx'), file('c.docx'), file('big.pdf', MAX_FILE_BYTES + 1), file('empty.csv', 0), file('a.pdf'),
    ]);
    expect(files.map(f => f.name)).toEqual(['a.pdf', 'b.xlsx']);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/only PDF, Excel/);
  });

  it(`caps a question at ${MAX_FILES_PER_MESSAGE} files`, () => {
    const many = Array.from({ length: MAX_FILES_PER_MESSAGE + 2 }, (_, i) => file(`f${i}.csv`));
    const { files, errors } = addFiles([], many);
    expect(files).toHaveLength(MAX_FILES_PER_MESSAGE);
    expect(errors).toEqual([`You can attach up to ${MAX_FILES_PER_MESSAGE} files to one question.`]);
  });

  it('makes names safe for a storage path', () => {
    expect(storageSafeName('Q2 survey (final)/v2.xlsx')).toBe('Q2_survey_finalv2.xlsx');
    expect(storageSafeName('..//')).toBe('file');
  });
});

describe('new-chat composer with files', () => {
  const renderWelcome = (onSend = vi.fn()) => {
    render(
      <ChatWelcome
        greeting="Hello"
        companyName="Acme"
        scope={EMPTY_SCOPE}
        scopeOptions={null}
        onScopeChange={() => {}}
        recent={[]}
        onSend={onSend}
        onOpenConversation={() => {}}
        onOpenList={() => {}}
      />,
    );
    return onSend;
  };

  it('attaches, removes and sends files; an empty question asks for the key insights', () => {
    const onSend = renderWelcome();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('survey.xlsx', 2048), file('deck.pdf', 4096)] } });

    expect(screen.getByText('survey.xlsx')).toBeInTheDocument();
    expect(screen.getByText('Files are private to you and used only to answer your questions.')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove deck.pdf'));
    expect(screen.queryByText('deck.pdf')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalledTimes(1);
    const [question, files] = onSend.mock.calls[0];
    expect(question).toBe(DEFAULT_FILE_QUESTION);
    expect(files.map((f: File) => f.name)).toEqual(['survey.xlsx']);
    expect(screen.queryByText('survey.xlsx')).not.toBeInTheDocument();
  });

  it('keeps send disabled with neither text nor files', () => {
    renderWelcome();
    expect(screen.getByLabelText('Send')).toBeDisabled();
  });
});
