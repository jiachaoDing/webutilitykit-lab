# Frontend UI Design Principles (WebUtilityKit Lab)

This guide aims to provide a unified, concise, and modern UI design standard for applications within the WebUtilityKit incubator. We use **Tailwind CSS** as the core styling framework and follow an "Edge-First" minimalism.

---

## 1. Core Visual Principles

### 1.1 Minimalism
- **Sense of Space**: Use generous spacing (Gap/Padding) to create visual breathing room. Avoid element crowding.
- **Visual Hierarchy**: Distinguish hierarchy through font weight and color depth rather than decorative lines.
- **De-decoration**: Reduce unnecessary borders, shadows, and decorative icons.

### 1.2 Atomization and Consistency
- Uniformly use Tailwind's preset values (e.g., `p-4`, `rounded-xl`, `shadow-sm`).
- Keep component shapes consistent (e.g., all card corners unified to `rounded-2xl`).

---

## 2. Colors and Themes (Tailwind CSS)

Supporting **Light** and **Dark** modes is a mandatory requirement. It is recommended to use Tailwind's `dark:` variant.

### 2.1 Backgrounds and Panels
- **Light Mode**: `bg-white` / `bg-slate-50`
- **Dark Mode**: `bg-slate-950` (Recommended) or `bg-gray-900`
- **Borders**: Use extremely light border colors, such as `border-slate-200` / `dark:border-slate-800`.

### 2.2 Accent Colors
- Recommended to use violet (`violet`) or blue (`blue`) series as the primary action color.
- Example: `text-violet-600 dark:text-violet-400`.

---

## 3. Typography

- **Sans-serif Fonts**: Prioritize using system default font stacks (`font-sans`).
- **Line Height**: Body text is recommended to use `leading-relaxed`.
- **Font Size Control**:
  - Title: `text-2xl` to `text-4xl`, bold `font-bold`.
  - Body: `text-base`.
  - Auxiliary text: `text-sm`, lightened color `text-slate-500`.

---

## 4. Interaction Experience

- **Micro-interactions**: Buttons and links should include smooth transition effects (`transition-all duration-200`).
- **Status Feedback**:
  - Hover: Slight background darkening or shadow enhancement.
  - Active: Slight scaling effect (`active:scale-95`).
- **Loading State**: Use Skeletons (Skeleton screens) instead of simple Loading icons.

---

## 5. Tailwind CLI Best Practices

### 5.1 Compilation Process
Use Tailwind CLI in the project root to compile and generate `public/assets/tailwind.css` in real-time:

```bash
# Real-time monitoring and generation
npx tailwindcss -i ./src/input.css -o ./public/assets/tailwind.css --watch
```

### 5.2 Responsive Design
- Prioritize writing mobile styles (Mobile First).
- Use `sm:`, `md:`, `lg:` breakpoints for adaptation.

---

## 6. Code Example (Modern Card)

```html
<div class="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm hover:shadow-md transition-all group">
  <h3 class="text-lg font-semibold text-slate-900 dark:text-white group-hover:text-violet-500 transition-colors">
    Modern Card Title
  </h3>
  <p class="mt-2 text-slate-600 dark:text-slate-400 leading-relaxed">
    A concise UI example built with Tailwind CSS, supporting automatic dark mode switching.
  </p>
</div>
```

---

## Conclusion
Excellent UI is not about tedious design, but about **precise proportions, restrained colors, and silky interactions**.
