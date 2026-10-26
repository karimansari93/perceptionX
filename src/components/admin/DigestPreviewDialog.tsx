// Preview of one member's quarterly update email, rendered by the
// quarterly-digest function from their saved view, with a "send test to me"
// action. The HTML is shown in a sandboxed iframe so the email's own styles
// never leak into the admin page.

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
import { sendDigestTest, type DigestPreview } from '@/services/digestService';

export interface DigestPreviewTarget {
  memberId: string;
  email: string;
  preview: DigestPreview;
}

interface Props {
  target: DigestPreviewTarget | null;
  onClose: () => void;
}

export const DigestPreviewDialog = ({ target, onClose }: Props) => {
  const [sending, setSending] = useState(false);

  const handleSendTest = async () => {
    if (!target) return;
    setSending(true);
    try {
      const r = await sendDigestTest(target.memberId);
      toast.success(`Sent ${target.email}'s email to ${r.sentTo}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the test');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.preview.subject ?? 'Quarterly email'}</DialogTitle>
          <DialogDescription>
            What {target?.email} would receive, built from their saved view. Nothing has been sent.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <iframe
            title="Quarterly email preview"
            sandbox=""
            srcDoc={target.preview.html}
            className="h-[70vh] w-full rounded-md border border-silver bg-white"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="border-silver" onClick={onClose}>Close</Button>
          <Button className="bg-pink text-white hover:bg-pink/90" onClick={handleSendTest} disabled={sending}>
            <Mail className="mr-2 h-4 w-4" />
            {sending ? 'Sending…' : 'Send test to me'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
