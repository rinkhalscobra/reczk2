import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, FileCheck2, FileText, Loader2, Pencil, Plus, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';

type KycSubmission = Database['public']['Tables']['kyc_submissions']['Row'];
type DocumentField = 'document_front_path' | 'document_back_path' | 'proof_of_address_path';

interface KycPanelProps {
  customerId: string;
  mode: 'client' | 'staff';
  initialFirstName?: string | null;
  initialLastName?: string | null;
}

interface KycFormState {
  legal_first_name: string;
  legal_last_name: string;
  date_of_birth: string;
  nationality: string;
  country_of_residence: string;
  residential_address: string;
  city: string;
  postal_code: string;
  document_type: string;
  document_number: string;
  document_front_path: string;
  document_back_path: string;
  proof_of_address_path: string;
}

const emptyForm = (firstName?: string | null, lastName?: string | null): KycFormState => ({
  legal_first_name: firstName || '',
  legal_last_name: lastName || '',
  date_of_birth: '',
  nationality: '',
  country_of_residence: '',
  residential_address: '',
  city: '',
  postal_code: '',
  document_type: 'passport',
  document_number: '',
  document_front_path: '',
  document_back_path: '',
  proof_of_address_path: '',
});

const formFromSubmission = (
  submission: KycSubmission | null,
  firstName?: string | null,
  lastName?: string | null,
): KycFormState => submission ? {
  legal_first_name: submission.legal_first_name || '',
  legal_last_name: submission.legal_last_name || '',
  date_of_birth: submission.date_of_birth || '',
  nationality: submission.nationality || '',
  country_of_residence: submission.country_of_residence || '',
  residential_address: submission.residential_address || '',
  city: submission.city || '',
  postal_code: submission.postal_code || '',
  document_type: submission.document_type || 'passport',
  document_number: submission.document_number || '',
  document_front_path: submission.document_front_path || '',
  document_back_path: submission.document_back_path || '',
  proof_of_address_path: submission.proof_of_address_path || '',
} : emptyForm(firstName, lastName);

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'border-slate-500/30 bg-slate-500/10 text-slate-400' },
  submitted: { label: 'Submitted', className: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
  in_review: { label: 'In review', className: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
  approved: { label: 'Approved', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' },
  rejected: { label: 'Action required', className: 'border-red-500/30 bg-red-500/10 text-red-400' },
};

const documentLabels: Record<DocumentField, string> = {
  document_front_path: 'Identity document (front / photo page)',
  document_back_path: 'Identity document (back)',
  proof_of_address_path: 'Proof of address',
};

export const KycPanel = ({ customerId, mode, initialFirstName, initialLastName }: KycPanelProps) => {
  const { toast } = useToast();
  const [submission, setSubmission] = useState<KycSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [form, setForm] = useState<KycFormState>(() => emptyForm(initialFirstName, initialLastName));
  const [files, setFiles] = useState<Partial<Record<DocumentField, File>>>({});

  const fetchSubmission = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('kyc_submissions')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error) {
      toast({ title: 'Could not load KYC', description: error.message, variant: 'destructive' });
    } else {
      setSubmission(data);
    }
    setLoading(false);
  }, [customerId, toast]);

  useEffect(() => {
    void fetchSubmission();
    const channel = supabase
      .channel(`kyc-${customerId}-${mode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kyc_submissions', filter: `customer_id=eq.${customerId}` }, () => {
        void fetchSubmission();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerId, fetchSubmission, mode]);

  const openForm = () => {
    setForm(formFromSubmission(submission, initialFirstName, initialLastName));
    setFiles({});
    setFormOpen(true);
  };

  const updateForm = (field: keyof KycFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const chooseFile = (field: DocumentField, file?: File) => {
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: 'Unsupported document', description: 'Upload a JPG, PNG, or PDF file.', variant: 'destructive' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Document is too large', description: 'Each file must be 10 MB or smaller.', variant: 'destructive' });
      return;
    }
    setFiles((current) => ({ ...current, [field]: file }));
  };

  const uploadFile = async (field: DocumentField, file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `${customerId}/${field}-${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('kyc-documents').upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    return path;
  };

  const persist = async (submit: boolean) => {
    if (submit) {
      const requiredValues = [
        form.legal_first_name, form.legal_last_name, form.date_of_birth, form.nationality,
        form.country_of_residence, form.residential_address, form.city, form.postal_code,
        form.document_type, form.document_number,
      ];
      if (requiredValues.some((value) => !value.trim()) || (!form.document_front_path && !files.document_front_path)) {
        toast({ title: 'Complete the required information', description: 'All identity fields and the front of the identity document are required.', variant: 'destructive' });
        return;
      }
    }

    setSaving(true);
    try {
      const payload = { ...form };
      for (const field of Object.keys(files) as DocumentField[]) {
        const file = files[field];
        if (file) payload[field] = await uploadFile(field, file);
      }

      const { error } = await supabase.rpc('save_kyc_submission', {
        p_customer_id: customerId,
        p_payload: payload as unknown as Json,
        p_submit: submit,
      });
      if (error) throw error;

      toast({
        title: submit ? 'KYC submitted' : 'KYC saved',
        description: submit ? 'Your identity information is ready for review.' : 'The identity-verification record was saved.',
      });
      setFormOpen(false);
      setFiles({});
      await fetchSubmission();
    } catch (error: unknown) {
      toast({
        title: 'Could not save KYC',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const review = async (status: 'in_review' | 'approved' | 'rejected') => {
    if (status === 'rejected' && !rejectionReason.trim()) {
      toast({ title: 'Enter a rejection reason', variant: 'destructive' });
      return;
    }
    setReviewing(true);
    try {
      const { error } = await supabase.rpc('review_kyc_submission', {
        p_customer_id: customerId,
        p_status: status,
        p_rejection_reason: status === 'rejected' ? rejectionReason.trim() : undefined,
      });
      if (error) throw error;
      toast({ title: status === 'approved' ? 'KYC approved' : status === 'rejected' ? 'KYC returned to client' : 'KYC marked as in review' });
      setRejectOpen(false);
      setRejectionReason('');
      await fetchSubmission();
    } catch (error: unknown) {
      toast({ title: 'Could not update KYC', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setReviewing(false);
    }
  };

  const viewDocument = async (path: string) => {
    const { data, error } = await supabase.storage.from('kyc-documents').createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast({ title: 'Could not open document', description: error?.message || 'Please try again.', variant: 'destructive' });
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const canClientEdit = !submission || ['draft', 'rejected'].includes(submission.status);
  const status = statusConfig[submission?.status || 'draft'];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-border">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" /> Identity verification (KYC)
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'client' ? 'Submit your identity details securely for account verification.' : 'Review identity details and supporting documents for this customer.'}
          </p>
        </div>
        {submission && <Badge variant="outline" className={status.className}>{status.label}</Badge>}
      </CardHeader>

      <CardContent className="p-5">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading KYC…</div>
        ) : !submission ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <FileCheck2 className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No KYC information has been added yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Start a secure identity-verification application.</p>
            <Button className="mt-4" size="sm" onClick={openForm}><Plus className="mr-2 h-4 w-4" /> Add KYC</Button>
          </div>
        ) : (
          <div className="space-y-5">
            {submission.rejection_reason && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <p className="font-semibold text-destructive">Changes requested</p>
                <p className="mt-1 text-muted-foreground">{submission.rejection_reason}</p>
              </div>
            )}

            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Legal name" value={`${submission.legal_first_name || ''} ${submission.legal_last_name || ''}`.trim()} />
              <Detail label="Date of birth" value={submission.date_of_birth} />
              <Detail label="Nationality" value={submission.nationality} />
              <Detail label="Country of residence" value={submission.country_of_residence} />
              <Detail label="Residential address" value={[submission.residential_address, submission.city, submission.postal_code].filter(Boolean).join(', ')} />
              <Detail label="Document" value={submission.document_type ? `${submission.document_type.replace(/_/g, ' ')} · ${submission.document_number || ''}` : null} />
            </dl>

            <div className="flex flex-wrap gap-2">
              {(Object.keys(documentLabels) as DocumentField[]).map((field) => {
                const path = submission[field];
                return path ? (
                  <Button key={field} size="sm" variant="outline" onClick={() => void viewDocument(path)}>
                    <Eye className="mr-2 h-4 w-4" /> {documentLabels[field]}
                  </Button>
                ) : null;
              })}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {(mode === 'staff' || canClientEdit) && (
                <Button size="sm" variant="outline" onClick={openForm}>
                  <Pencil className="mr-2 h-4 w-4" /> {mode === 'client' ? 'Update KYC' : 'Edit details'}
                </Button>
              )}
              {mode === 'staff' && submission.status !== 'approved' && (
                <>
                  {submission.status !== 'in_review' && <Button size="sm" variant="secondary" disabled={reviewing} onClick={() => void review('in_review')}>Mark in review</Button>}
                  <Button size="sm" disabled={reviewing} onClick={() => void review('approved')}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve</Button>
                  <Button size="sm" variant="destructive" disabled={reviewing} onClick={() => setRejectOpen(true)}><XCircle className="mr-2 h-4 w-4" /> Reject</Button>
                </>
              )}
            </div>

            {mode === 'client' && ['submitted', 'in_review'].includes(submission.status) && (
              <p className="text-sm text-muted-foreground">Your submission is locked while the compliance team reviews it.</p>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={(open) => !saving && setFormOpen(open)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-card sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{submission ? 'Update KYC information' : 'Add KYC information'}</DialogTitle>
            <DialogDescription>Identity documents are stored privately and are available only to the customer and authorized CRM staff.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal first name" value={form.legal_first_name} onChange={(value) => updateForm('legal_first_name', value)} />
            <Field label="Legal last name" value={form.legal_last_name} onChange={(value) => updateForm('legal_last_name', value)} />
            <Field label="Date of birth" type="date" value={form.date_of_birth} onChange={(value) => updateForm('date_of_birth', value)} />
            <Field label="Nationality" value={form.nationality} onChange={(value) => updateForm('nationality', value)} placeholder="e.g. Canadian" />
            <Field label="Country of residence" value={form.country_of_residence} onChange={(value) => updateForm('country_of_residence', value)} placeholder="Country" />
            <Field label="City" value={form.city} onChange={(value) => updateForm('city', value)} />
            <Field label="Residential address" value={form.residential_address} onChange={(value) => updateForm('residential_address', value)} className="sm:col-span-2" />
            <Field label="Postal / ZIP code" value={form.postal_code} onChange={(value) => updateForm('postal_code', value)} />
            <div className="space-y-2">
              <Label>Document type</Label>
              <Select value={form.document_type} onValueChange={(value) => updateForm('document_type', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="passport">Passport</SelectItem>
                  <SelectItem value="national_id">National identity card</SelectItem>
                  <SelectItem value="drivers_license">Driver's licence</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field label="Document number" value={form.document_number} onChange={(value) => updateForm('document_number', value)} />
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            {(Object.keys(documentLabels) as DocumentField[]).map((field) => (
              <div key={field} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Label htmlFor={`kyc-${field}`}>{documentLabels[field]}{field === 'document_front_path' ? ' *' : ''}</Label>
                  {form[field] && <span className="flex items-center gap-1 text-xs text-success"><FileText className="h-3.5 w-3.5" /> Uploaded</span>}
                </div>
                <Input id={`kyc-${field}`} type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => chooseFile(field, event.target.files?.[0])} />
                {files[field] && <p className="mt-1 text-xs text-muted-foreground">Selected: {files[field]?.name}</p>}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Accepted formats: JPG, PNG, or PDF. Maximum 10 MB per file.</p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</Button>
            {mode === 'client' && <Button variant="secondary" disabled={saving} onClick={() => void persist(false)}>Save draft</Button>}
            <Button disabled={saving} onClick={() => void persist(mode === 'client')}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {mode === 'client' ? 'Submit for review' : 'Save KYC'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={(open) => !reviewing && setRejectOpen(open)}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request KYC changes</DialogTitle>
            <DialogDescription>Explain exactly what the customer needs to correct or upload again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="kyc-rejection-reason">Reason</Label>
            <Textarea id="kyc-rejection-reason" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} className="min-h-28" maxLength={1000} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={reviewing} onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={reviewing || !rejectionReason.trim()} onClick={() => void review('rejected')}>
              {reviewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send to client
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

const Detail = ({ label, value }: { label: string; value?: string | null }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-words font-medium capitalize text-foreground">{value || 'Not provided'}</dd>
  </div>
);

const Field = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) => {
  const id = `kyc-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={`space-y-2 ${className || ''}`}>
      <Label htmlFor={id}>{label} *</Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={120} />
    </div>
  );
};

export default KycPanel;
