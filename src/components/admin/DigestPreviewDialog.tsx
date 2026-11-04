// Preview of one member's quarterly update email, rendered by the
// quarterly-digest function from their saved view, with a "send test to me"
// action. Once a test is sent, "Send this version" sends that member exactly
// the tested email (same figures and prose), and nobody else. The HTML is
// shown in a sandboxed iframe so the email's own styles never leak into the
// admin page.

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Mail, Send } from 'lucide-react';
import { sendDigestTest, sendTestedDigest, type DigestPreview } from '@/services/digestService';

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
  const [tested, setTested] = useState(false);
  // The dialog is reused across members: a test for one never unlocks another.
  useEffect(() => { setTested(false); }, [target?.memberId]);

  const handleSendTest = async () => {
    if (!target) return;
    setSending(true);
    try {
      const r = await sendDigestTest(target.memberId);
      setTested(true);
      toast.success(`Sent ${target.email}'s email to ${r.sentTo}. Check it, then use "Send this version" to send it to ${target.email}.`);
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
          {tested && (
            <Button
              variant="outline"
              className="border-pink text-pink hover:bg-pink/10"
              disabled={sending}
              onClick={async () => {
                if (!target || !window.confirm(`Send the email you just tested to ${target.email}? Only they receive it.`)) return;
                setSending(true);
                try {
                  const r = await sendTestedDigest(target.memberId);
                  toast.success(`Sent to ${r.sentTo}`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not send');
                } finally {
                  setSending(false);
                }
              }}
            >
              <Send className="mr-2 h-4 w-4" />
              Send this version to {target?.email}
            </Button>
          )}
          <Button className="bg-pink text-white hover:bg-pink/90" onClick={handleSendTest} disabled={sending}>
            <Mail className="mr-2 h-4 w-4" />
            {sending ? 'Sending…' : 'Send test to me'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
