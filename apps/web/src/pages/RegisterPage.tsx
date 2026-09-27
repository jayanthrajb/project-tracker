import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { toast } from 'react-hot-toast';

import { api } from '../lib/api';
import type { ApiError } from '../lib/api';
import type { User } from '../types';

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'MANAGER', 'DEVELOPER']),
});

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { role: 'DEVELOPER' } });

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => api<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success('Account created');
      navigate('/');
    },
    onError: (error: ApiError) => toast.error(error.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <h1 className="text-2xl font-semibold">Create account</h1>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-1 text-sm"><span>Name</span><input className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('name')} /></label>
          <label className="grid gap-1 text-sm"><span>Email</span><input className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('email')} /></label>
          <label className="grid gap-1 text-sm"><span>Password</span><input type="password" className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('password')} /></label>
          <label className="grid gap-1 text-sm"><span>Role</span><select className="rounded-lg border border-slate-300 px-3 py-2" {...form.register('role')}><option>DEVELOPER</option><option>MANAGER</option><option>ADMIN</option></select></label>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-white">Register</button>
        </div>
        <p className="mt-4 text-sm text-slate-500">Already registered? <Link className="text-slate-900 underline" to="/login">Login</Link></p>
      </form>
    </div>
  );
}
