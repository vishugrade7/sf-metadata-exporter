# Salesforce Metadata Exporter

## 🚀 Overview

Salesforce Metadata Exporter is a powerful VS Code extension that streamlines your Salesforce development workflow. Export metadata types with advanced filtering, intelligent folder navigation, and lightning-fast search capabilities.

### Why Choose This Extension?

- ⚡ **Blazing Fast** - Optimized performance with lazy loading and chunked rendering
- 🎯 **Smart Filtering** - Filter by user, date, and search with context-aware results
- 📁 **Folder Navigation** - Hierarchical view for organized metadata browsing
- 🎨 **Beautiful UI** - Modern, dark-themed interface that matches VS Code
- 💾 **Persistent State** - Your selections are saved across sessions
- 🔄 **Bulk Operations** - Select multiple items across different metadata types

---

## ✨ Features

### 🗂️ Hierarchical Folder View
Browse metadata organized by folders. Click to expand and see nested items. Search filters only the current view for precise results.

### 🔍 Context-Aware Search
- **At folder level**: Search only folder names
- **Inside folders**: Search only items within that folder
- **Real-time filtering**: Results update as you type

### 🎛️ Advanced Filtering
- **User Filter**: Filter by last modified user
- **Date Filter**: Find metadata modified on specific dates
- **Lock Filters**: Keep your filter settings when switching types
- **Multi-criteria**: Combine filters for precise results

### ✅ Smart Selection
- **Checkbox selection**: Click rows or checkboxes to select
- **Select all**: Bulk select all filtered items
- **Persistent selections**: Selections saved across metadata types
- **Visual feedback**: Selected items highlighted with badges

### 📋 Export Options
- **Copy to Clipboard**: Generate and copy `package.xml` instantly
- **Update package.xml**: Directly update your project's manifest file
- **Bulk export**: Export selections from multiple metadata types at once

### 🎨 Modern Interface
- **Dark theme**: Easy on the eyes, matches VS Code
- **Smooth animations**: Polished micro-interactions
- **Responsive design**: Adapts to your window size
- **Skeleton loading**: Visual feedback during data fetching

---

## 📦 Installation

### From VSIX File
1. Download the latest `.vsix` file
2. Open VS Code
3. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
4. Type "Install from VSIX"
5. Select the downloaded `.vsix` file

### Requirements
- **VS Code**: Version 1.80.0 or higher
- **Salesforce CLI**: Must be authenticated with a Salesforce org

---

## 🎯 Usage

### Getting Started

1. **Open the Extension**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "SF Metadata Exporter: Open"
   - Press Enter

2. **Select a Metadata Type**
   - Click any metadata type from the left sidebar
   - Use the search box to filter types

3. **Browse and Select**
   - Navigate through folders by clicking them
   - Use the search bar to filter items
   - Click checkboxes or rows to select items

4. **Export**
   - Click "Copy" to copy `package.xml` to clipboard
   - Click "Update package.xml" to update your project file

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open Extension | `Cmd+Shift+P` → "SF Metadata Exporter: Open" |
| Search Types | Click search box in sidebar |
| Search Members | Click search box in main panel |

### Tips & Tricks

💡 **Tip 1**: Use the lock button 🔒 to keep your filters active when switching between metadata types

💡 **Tip 2**: Search is context-aware - it only searches what you can see on screen

💡 **Tip 3**: Click the back button or breadcrumb to navigate up from folders

💡 **Tip 4**: Selection badges show how many items you've selected per type

---

## 📸 Screenshots

### Main Interface
![Main Interface](https://raw.githubusercontent.com/vishugrade/sf-metadata-exporter/main/images/1.jpg)
*Browse metadata types with hierarchical folder navigation*

### Advanced Filtering
![Advanced Filtering](https://raw.githubusercontent.com/vishugrade/sf-metadata-exporter/main/images/2.jpg)
*Filter by user, date, and search with real-time results*



<div align="center">

**Made with ❤️ for Salesforce Developers**

⭐ Star this repo if you find it helpful!

</div>

---

<div align="center" style="background: linear-gradient(135deg, #007ACC 0%, #005A9E 100%); padding: 30px; border-radius: 10px; margin-top: 40px;">

### 💙 Connect & Support

<p style="color: white; font-size: 16px; margin: 20px 0;">
If this extension helped you, consider supporting the development!
</p>

<p>
  <a href="https://www.linkedin.com/in/vishugrade/" target="_blank">
    <img src="https://img.shields.io/badge/LinkedIn-Connect-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn">
  </a>
  &nbsp;&nbsp;
  <a href="https://buymeacoffee.com/vishugradeb" target="_blank">
    <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee">
  </a>
</p>

<p style="color: #E0E0E0; font-size: 14px; margin-top: 20px;">
  Built by <strong>Vishu Grade</strong> | Salesforce Developer & VS Code Extension Creator
</p>

</div>
# sf-metadata-exporter
