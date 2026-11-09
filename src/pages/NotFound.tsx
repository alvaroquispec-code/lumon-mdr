import { Link } from 'react-router-dom';
export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div>
        <h1 className="text-3xl font-semibold">404</h1>
        <p className="mt-2 text-slate-300">Esta sala no existe en el piso separado.</p>
        <Link className="mt-4 inline-block text-teal-300 underline" to="/files">Volver a los archivos</Link>
      </div>
    </main>
  );
}
