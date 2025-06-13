(function() {
    'use strict';

    // --- DOM Elements ---
    const citationForm = document.getElementById('citation-form');
    const titleInput = document.getElementById('batch-title-input');
    const styleSelector = document.getElementById('style-selector');
    const clearInputBtn = document.getElementById('clear-input-btn');
    const resultsContainer = document.getElementById('results-container');
    const bulkActionsContainer = document.getElementById('bulk-actions-container');
    const viewSwitcher = document.querySelector('.view-switcher');
    const historyListContainer = document.getElementById('history-list-container');
    const HISTORY_KEY = 'citationHistory';
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // --- Initialization ---
    function init() {
        citationForm.addEventListener('submit', handleFormSubmit);
        clearInputBtn.addEventListener('click', () => titleInput.value = '');
        resultsContainer.addEventListener('click', handleResultsClick);
        bulkActionsContainer.addEventListener('click', handleActionClick);
        viewSwitcher.addEventListener('click', handleViewSwitch);
        historyListContainer.addEventListener('click', handleHistoryItemClick);
        renderHistoryView();
        console.log('Citation Generator Initialized.');
    }

    // --- Event Delegation ---
    function handleResultsClick(event) {
        if (event.target.classList.contains('result-card__copy-btn')) {
            handleCopyClick(event);
        }
        const titleHeader = event.target.closest('.batch-result-item__title');
        if (titleHeader) {
            titleHeader.parentElement.classList.toggle('active');
        }
    }

    // --- View Management & History ---
    function handleViewSwitch(event) {
        if (!event.target.matches('.view-switcher__button')) return;
        const viewToShow = event.target.dataset.view;
        document.querySelectorAll('.view-switcher__button').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `${viewToShow}-view`));
        if (viewToShow === 'history') renderHistoryView();
    }
    function getHistory() {
        const history = localStorage.getItem(HISTORY_KEY);
        if (!history) return [];
        const parsedHistory = JSON.parse(history);
        return parsedHistory.filter(entry => (Date.now() - entry.timestamp) < ONE_DAY_MS);
    }
    function saveToHistory(queryTitles, style, results) {
        const history = getHistory();
        const newEntry = { id: Date.now(), timestamp: Date.now(), queryTitles, style, results };
        history.unshift(newEntry);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
    }
    function renderHistoryView() {
        const history = getHistory();
        if (history.length === 0) {
            historyListContainer.innerHTML = '<p>暂无历史记录。</p>';
            return;
        }
        historyListContainer.innerHTML = history.map(entry => {
            const count = entry.queryTitles.length;
            let titleDisplay = (count === 1) ? entry.queryTitles[0] : `<strong>批量查询 (${count} 篇):</strong> ${entry.queryTitles[0]}`;
            return `<a href="#" class="history-item" data-id="${entry.id}"><h4 class="history-item__title">${titleDisplay.substring(0, 100)}...</h4><p class="history-item__date">(${entry.style.toUpperCase()}) ${new Date(entry.timestamp).toLocaleString()}</p></a>`;
        }).join('');
    }
    function handleHistoryItemClick(event) {
        const target = event.target.closest('.history-item');
        if (!target) return;
        event.preventDefault();
        const historyId = Number(target.dataset.id);
        const entry = getHistory().find(item => item.id === historyId);
        if (entry) {
            document.querySelector('.view-switcher__button[data-view="generator"]').click();
            displayBatchResults(entry.results, entry.style, true);
            titleInput.value = entry.queryTitles.join('\n');
            styleSelector.value = entry.style;
        }
    }

    // --- Core Logic ---
    async function handleFormSubmit(event) {
        event.preventDefault();
        const titles = titleInput.value.trim().split('\n').filter(Boolean);
        if (titles.length === 0) {
            alert('请输入至少一个文献标题！');
            return;
        }
        resultsContainer.innerHTML = `<div class="loading-spinner-container"><div class="loading-spinner"></div></div>`;
        bulkActionsContainer.innerHTML = '';
        const selectedStyle = styleSelector.value;
        const promises = titles.map(title => fetchAndFormat(title, selectedStyle));
        const results = await Promise.allSettled(promises);
        displayBatchResults(results, selectedStyle);
        saveToHistory(titles, selectedStyle, results);
    }
    async function fetchAndFormat(title, style) {
        try {
            const response = await fetch(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=1`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data.message.items.length === 0) throw new Error('找不到相关文献');
            const item = data.message.items[0];
            const formatter = formatters[style] || formatters.apa;
            return { title, status: 'fulfilled', data: formatter(item) };
        } catch (error) {
            return { title, status: 'rejected', reason: error.message };
        }
    }
    function displayBatchResults(results, style, expandAll = false) {
        if (results.length === 0) {
            resultsContainer.innerHTML = '';
            return;
        }
        const styleName = styleSelector.querySelector(`option[value="${style}"]`).textContent;
        const activeClass = expandAll ? 'active' : '';
        resultsContainer.innerHTML = results.map(result => {
            if (result.status === 'fulfilled') {
                const { title, data } = result.value;
                return `<div class="batch-result-item ${activeClass}" data-title="${title}"><h3 class="batch-result-item__title">${title}</h3><div class="batch-result-item__content">${createResultCardHTML(`完整参考文献 (${styleName})`, data.fullReference, 'full-reference')}${createResultCardHTML('文内引用 (括号)', data.inText.parenthetical, 'in-text-parenthetical')}${createResultCardHTML('文内引用 (叙述)', data.inText.narrative, 'in-text-narrative')}</div></div>`;
            } else {
                return `<div class="batch-result-item"><h3 class="batch-result-item__title">${result.reason.title || '未知标题'}</h3><div class="batch-result-item__content"><p class="error-message">获取失败: ${result.reason.reason || '未知错误'}</p></div></div>`;
            }
        }).join('');
        if (results.some(r => r.status === 'fulfilled')) {
            bulkActionsContainer.innerHTML = `<button class="bulk-actions__button" data-action="copy" data-type="full-reference">一键复制完整引用列表</button><button class="bulk-actions__button" data-action="copy" data-type="in-text-parenthetical">一键复制(括号)</button><button class="bulk-actions__button" data-action="copy" data-type="in-text-narrative">一键复制(叙述)</button><button class="bulk-actions__button" data-action="export-txt">导出为 .txt</button>`;
        }
    }
    function createResultCardHTML(title, content, type) {
        return `<div class="result-card" data-type="${type}"><div class="result-card__title"><span>${title}</span><button class="result-card__copy-btn">复制</button></div><div class="result-card__content"><p>${content}</p></div></div>`;
    }

    // --- Actions (Copy & Export) ---
    function handleActionClick(event) {
        if (!event.target.matches('.bulk-actions__button')) return;
        const action = event.target.dataset.action;
        if (action === 'copy') handleBulkCopyClick(event);
        if (action === 'export-txt') handleExportTxt();
    }
    
    // --- UPDATED: handleExportTxt ---
    function handleExportTxt() {
        const resultItems = resultsContainer.querySelectorAll('.batch-result-item');
        if (resultItems.length === 0) {
            alert('没有可导出的内容。');
            return;
        }

        const allFullRefs = [];
        const allParentheticals = [];
        const allNarratives = [];

        const detailedContent = Array.from(resultItems).map((item, index) => {
            const titleElem = item.querySelector('.batch-result-item__title');
            const fullRefElem = item.querySelector('[data-type="full-reference"] .result-card__content p');
            if (!fullRefElem) return null;

            const title = titleElem ? titleElem.innerText : '未知标题';
            const fullRef = fullRefElem.innerText;
            const parenthetical = item.querySelector('[data-type="in-text-parenthetical"] .result-card__content p')?.innerText || '';
            const narrative = item.querySelector('[data-type="in-text-narrative"] .result-card__content p')?.innerText || '';

            allFullRefs.push(fullRef);
            allParentheticals.push(parenthetical);
            allNarratives.push(narrative);

            return `---------- ${index + 1} ----------\n` +
                   `文献标题: ${title}\n\n` +
                   `完整参考文献:\n${fullRef}\n\n` +
                   `文内引用 (括号):\n${parenthetical}\n\n` +
                   `文内引用 (叙述):\n${narrative}\n`;
        }).filter(Boolean).join('\n========================\n\n');

        if (allFullRefs.length === 0) {
            alert('没有可成功生成的引用以供导出。');
            return;
        }

        const separator = "==================================================";
        const fullRefListHeader = `${separator}\n==   完整参考文献列表 (Reference List)   ==\n${separator}`;
        const parentheticalListHeader = `${separator}\n==      文内引用 (括号) 列表      ==\n${separator}`;
        const narrativeListHeader = `${separator}\n==      文内引用 (叙述) 列表      ==\n${separator}`;
        const detailedEntriesHeader = `${separator}\n==         详细条目 (Detailed Entries)         ==\n${separator}`;

        const fullRefList = allFullRefs.join('\r\n\r\n');
        const parentheticalList = allParentheticals.join('\r\n');
        const narrativeList = allNarratives.join('\r\n');

        const finalContent = `${fullRefListHeader}\r\n\r\n${fullRefList}\r\n\r\n\r\n` +
                             `${parentheticalListHeader}\r\n\r\n${parentheticalList}\r\n\r\n\r\n` +
                             `${narrativeListHeader}\r\n\r\n${narrativeList}\r\n\r\n\r\n` +
                             `${detailedEntriesHeader}\r\n\r\n${detailedContent}`;

        const blob = new Blob([finalContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url; a.download = `references-${date}.txt`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    function handleCopyClick(event) {
        copyText(event.target, button => button.closest('.result-card').querySelector('.result-card__content p').innerText);
    }
    function handleBulkCopyClick(event) {
        const type = event.target.dataset.type;
        const textToCopy = Array.from(resultsContainer.querySelectorAll(`.result-card[data-type="${type}"] .result-card__content p`)).map(p => p.innerText).join('\n');
        copyText(event.target, () => textToCopy, "已复制列表!");
    }
    function copyText(button, textProvider, successMessage = '已复制!') {
        const contentToCopy = textProvider(button);
        if (!contentToCopy) return;
        navigator.clipboard.writeText(contentToCopy).then(() => {
            const originalText = button.innerText;
            button.innerText = successMessage;
            button.classList.add('copied');
            setTimeout(() => {
                button.innerText = originalText;
                button.classList.remove('copied');
            }, 2000);
        }).catch(err => alert('复制失败，您的浏览器可能不支持此功能。'));
    }

    // --- Formatters ---
    function isChinese(item) {
        const title = item.title?.[0] || '';
        const authors = (item.author || []).map(a => `${a.family || ''} ${a.given || ''}`).join('');
        const regex = /[\u4e00-\u9fa5]/;
        return regex.test(title) || regex.test(authors);
    }
    function finalizePunctuation(str, isChinese) {
        if (!isChinese) return str;
        return str.replace(/, /g, '，').replace(/\. /g, '。 ').replace(/ \(/g, '（').replace(/\) /g, '）').replace(/\.&/g, ' &').replace(/\.$/, '。');
    }
    const formatters = { apa: formatAPA7, mla: formatMLA9, chicago: formatChicago17 };
    function formatAPA7(item) {
        const isCn = isChinese(item); const authors = formatAuthors(item.author, 'apa', isCn);
        const year = item.issued?.['date-parts']?.[0]?.[0] || '[n.d.]';
        const title = item.title?.[0] || '[无标题]'; const sentenceCaseTitle = title.charAt(0).toUpperCase() + title.slice(1);
        const journal = `<em>${item['container-title']?.[0] || ''}</em>`; const volume = item.volume ? `<em>${item.volume}</em>` : '';
        const issue = item.issue ? `(${item.issue})` : ''; const pages = item.page ? `, ${item.page}` : '';
        const doi = item.DOI ? ` https://doi.org/${item.DOI}` : '';
        const fullReference = `${authors} (${year}). ${sentenceCaseTitle}. ${journal}${volume}${issue}${pages}.${doi}`;
        return { fullReference: finalizePunctuation(fullReference, isCn), inText: formatInText(item, 'apa', isCn) };
    }
    function formatMLA9(item) {
        const isCn = isChinese(item); const authors = formatAuthors(item.author, 'mla', isCn);
        const year = item.issued?.['date-parts']?.[0]?.[0] || '[n.d.]';
        const title = item.title?.[0] || '[无标题]'; const journal = `<em>${item['container-title']?.[0] || ''}</em>`;
        const volume = item.volume ? `, vol. ${item.volume}` : ''; const issue = item.issue ? `, no. ${item.issue}` : '';
        const pages = item.page ? `, pp. ${item.page}` : ''; const doi = item.DOI ? `, https://doi.org/${item.DOI}` : '';
        const fullReference = `${authors}. "${title}." ${journal}${volume}${issue}, ${year}${pages}.${doi}`;
        return { fullReference: finalizePunctuation(fullReference, isCn), inText: formatInText(item, 'mla', isCn) };
    }
    function formatChicago17(item) {
        const isCn = isChinese(item); const authors = formatAuthors(item.author, 'chicago', isCn);
        const year = item.issued?.['date-parts']?.[0]?.[0] || '[n.d.]';
        const title = item.title?.[0] || '[无标题]'; const journal = `<em>${item['container-title']?.[0] || ''}</em>`;
        const volume = item.volume || ''; const issue = item.issue ? `, no. ${item.issue}` : '';
        const pages = item.page ? `: ${item.page}` : ''; const doi = item.DOI ? ` https://doi.org/${item.DOI}` : '';
        const fullReference = `${authors}. ${year}. "${title}." ${journal} ${volume}${issue}${pages}.${doi}`;
        return { fullReference: finalizePunctuation(fullReference, isCn), inText: formatInText(item, 'chicago', isCn) };
    }
    function formatAuthors(authors, style, isCn = false) {
        if (!authors || authors.length === 0) return '[No Author]';
        const totalAuthors = authors.length;
        if (isCn) { return authors.map(author => `${author.family || ''}${author.given || ''}`).join('，');}
        if (style === 'mla') {
            if (totalAuthors >= 3) { return `${authors[0].family}, ${authors[0].given}, et al.`; } 
            else if (totalAuthors === 2) { return `${authors[0].family}, ${authors[0].given}, and ${authors[1].given} ${authors[1].family}`; } 
            else { return `${authors[0].family}, ${authors[0].given}`; }
        }
        if (style === 'chicago') {
            if (totalAuthors > 10) {
                const authorList = authors.slice(0, 7);
                const firstAuthor = `${authorList[0].family}, ${authorList[0].given}`;
                const otherAuthors = authorList.slice(1).map(a => `${a.given} ${a.family}`).join(', ');
                return `${firstAuthor}, ${otherAuthors}, et al.`;
            } else {
                const firstAuthor = `${authors[0].family}, ${authors[0].given}`;
                const otherAuthors = authors.slice(1).map(a => `${a.given} ${a.family}`);
                if(otherAuthors.length > 0) { const lastAuthor = otherAuthors.pop(); return `${firstAuthor}${otherAuthors.length > 0 ? ', ' : ''}${otherAuthors.join(', ')}, and ${lastAuthor}`; }
                return firstAuthor;
            }
        }
        let authorList = authors; let etAlString = '';
        if (totalAuthors > 20) {
            authorList = [...authors.slice(0, 19), authors[totalAuthors - 1]];
            etAlString = '...';
        }
        const formattedAuthors = authorList.map(author => `${author.family}, ${author.given.split(/\s+|-/).map(p => p[0]).join('. ')}.`);
        if (formattedAuthors.length > 1) {
            const lastAuthor = formattedAuthors.pop();
            const etAlInsert = etAlString ? `${etAlString} ` : '';
            return `${formattedAuthors.join(', ')}, ${etAlInsert}& ${lastAuthor}`;
        }
        return formattedAuthors[0];
    }
    function formatInText(item, style, isCn = false) {
        const year = item.issued?.['date-parts']?.[0]?.[0] || 'n.d.';
        if (!item.author || item.author.length === 0) {
            const title = `"${(item.title?.[0] || '[无标题]').slice(0, 20)}..."`;
            return { parenthetical: `(${title}， ${year})`, narrative: `${title} (${year})` };
        }
        let authorStr = ''; const totalAuthors = item.author.length;
        if (totalAuthors >= 3) {
            const firstAuthor = isCn ? `${item.author[0].family || ''}${item.author[0].given || ''}` : item.author[0].family || '';
            authorStr = isCn ? `${firstAuthor}等` : `${firstAuthor} et al.`;
        } else if (totalAuthors === 2) {
            const conjunction = isCn ? '和' : ((style === 'mla' || style === 'chicago') ? 'and' : '&');
            const author1 = isCn ? `${item.author[0].family || ''}${item.author[0].given || ''}` : item.author[0].family || '';
            const author2 = isCn ? `${item.author[1].family || ''}${item.author[1].given || ''}` : item.author[1].family || '';
            authorStr = `${author1} ${conjunction} ${author2}`;
        } else {
            authorStr = isCn ? `${item.author[0].family || ''}${item.author[0].given || ''}` : item.author[0].family || '';
        }
        const parenthetical = `(${authorStr}, ${year})`;
        const narrative = `${authorStr.replace(' & ', ' and ')} (${year})`;
        return { parenthetical: finalizePunctuation(parenthetical, isCn), narrative: finalizePunctuation(narrative, isCn) };
    }

    document.addEventListener('DOMContentLoaded', init);
})();