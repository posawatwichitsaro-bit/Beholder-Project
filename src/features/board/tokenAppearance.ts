const palette = ['#d2a557', '#83b6aa', '#bba3d4', '#d68878']

export const tokenColor = (index: number) => palette[index % palette.length] ?? '#9aa6a0'
export const tokenInitials = (name: string) => Array.from(name.trim()).slice(0, 2).join('').toUpperCase()
