
export function Sidebar({ title, items, current, onChange }) {
  return (
    <aside className='w-64 bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800'>
      <div className='p-4 border-b border-slate-800'>
        <h2 className='text-lg font-semibold'>{title}</h2>
      </div>

      <nav className='flex-1 p-3 space-y-1'>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={
              'w-full text-left px-3 py-2 rounded-lg text-sm transition ' +
              (current === item.id
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800')
            }
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className='p-4 border-t border-slate-800 text-[11px] text-slate-500'>
        Version Beta<br/>© 2025 Mimmoza
      </div>
    </aside>
  );
}

