# CurriculumOS
The vibecoder educator's all-in-one solution.

**Frictionless curriculum design. Directly synced to your file system.**

---

### 📥 [Download Latest Release for macOS](https://github.com/yourusername/CurriculumOS/releases/latest)
> [!IMPORTANT]
> CurriculumOS is currently optimized for **macOS only**.

---

CurriculumOS is a powerful, local-first environment designed for educators and curriculum designers. It provides a seamless interface for organizing learning materials, generating previews, and managing educational assets directly from your local directory.

## 🚀 Features

- **Local-First Architecture**: Your data stays on your machine, synced directly to your file system.
- **Multi-Format Support**: Create and manage content in HTML, LaTeX, Typst, Markdown, JSON, and more.
- **Interactive Presentation Mode**: Professional slide-based presentation mode with built-in tools like sticky notes and timers.
- **Real-Time Previews**: Instant live previews for code-based activities.
- **Document Compilation**: Built-in support for compiling high-quality PDFs via LaTeX and Typst.
- **Asset Management**: Attach videos, EPUBs, and external links directly to your curriculum nodes.
- **Customizable Structure**: Organize your courses into Units, Chapters, or any custom hierarchy you prefer.

## 🛠️ Getting Started (For Users)

1. **Download**: Grab the latest `.dmg` from the [Releases](https://github.com/dwoodallen/CurriculumOS/releases) page.
2. **Install**: Open the `.dmg` and drag CurriculumOS to your Applications folder.
3. **Prerequisites (Optional)**:
   To use the advanced PDF compilation features, you'll need:
   - **LaTeX**: Install [MacTeX](https://www.tug.org/mactex/) or run `brew install --cask mactex-no-gui`
   - **Typst**: Run `brew install typst`

## 👩‍💻 For Developers

If you want to contribute or build from source:

### Prerequisites
- **Node.js**: [Download](https://nodejs.org/) or run `brew install node`
- **MacTeX** (Optional, for LaTeX)
- **Typst** (Optional, for Typst)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/CurriculumOS.git
   cd CurriculumOS
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the application:
   ```bash
   npm start
   ```

## 📺 Presentation Mode Shortcuts

While in Presentation Mode, use the following shortcuts:
- `;` : Toggle Sticky Note
- `[` : Toggle Presentation Timer
- `Space` / `Right Arrow` : Next Slide
- `Left Arrow` : Previous Slide
- `Esc` : Exit Presentation

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👤 Author

**David Wood**
- GitHub: [@dwoodallen](https://github.com/dwoodallen)
