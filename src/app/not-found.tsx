import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen w-full bg-[#FDFBF9] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center space-y-6">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">404 - Page Not Found</h2>
          <p className="text-sm text-slate-500 mt-2 font-medium leading-relaxed">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-block w-full py-3.5 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-all shadow-md hover:shadow-lg text-center"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
