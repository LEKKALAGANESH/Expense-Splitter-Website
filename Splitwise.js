document.addEventListener('DOMContentLoaded', () => {
    // STATE MANAGEMENT
    let state = JSON.parse(localStorage.getItem('splitwise_app')) || { groups: [], members: [], expenses: [] };
    const save = () => localStorage.setItem('splitwise_app', JSON.stringify(state));

    let activeGroupId = null;

    // UTILITY FUNCTIONS
    const getGroupMembers = (groupId) => {
        const group = state.groups.find(g => g.id === groupId);
        if (!group) return [];
        return group.memberIds.map(id => state.members.find(m => m.id === id)).filter(Boolean);
    };
    const getMemberName = (id) => state.members.find(m => m.id === id)?.name || 'Unknown';

    // DOM ELEMENTS
    const groupsList = document.getElementById('groups-list');
    const addGroupForm = document.getElementById('add-group-form');
    const groupNameInput = document.getElementById('group-name');
    const membersList = document.getElementById('members-list');
    const addMemberForm = document.getElementById('add-member-form');
    const memberNameInput = document.getElementById('member-name');
    const addMemberButton = addMemberForm.querySelector('button');
    const currentGroupName = document.getElementById('current-group-name');
    const addExpenseForm = document.getElementById('add-expense-form');
    const expenseDescription = document.getElementById('expense-description');
    const expenseAmount = document.getElementById('expense-amount');
    const expensePayer = document.getElementById('expense-payer');
    const expenseParticipants = document.getElementById('expense-participants');
    const dynamicSplitInputs = document.getElementById('dynamic-split-inputs');
    const addExpenseButton = addExpenseForm.querySelector('button');
    const expensesList = document.getElementById('expenses-list');
    const balancesList = document.getElementById('balances-list');
    const settlementsList = document.getElementById('settlements-list');
    
    // Rename modal elements
    const renameModal = document.getElementById('rename-modal');
    const renameModalTitle = document.getElementById('rename-modal-title');
    const renameInput = document.getElementById('rename-input');
    const renameCancel = document.getElementById('rename-cancel');
    const renameConfirm = document.getElementById('rename-confirm');
    
    // Rename state
    let renameType = null;
    let renameId = null;

    // Rename modal functions
    function showRenameModal(type, id, currentName) {
        renameType = type;
        renameId = id;
        renameModalTitle.textContent = `Rename ${type}`;
        renameInput.value = currentName;
        renameModal.style.display = 'block';
        renameInput.focus();
    }

    function hideRenameModal() {
        renameModal.style.display = 'none';
        renameType = null;
        renameId = null;
        renameInput.value = '';
    }

    function handleRename() {
        const newName = renameInput.value.trim();
        if (!newName) {
            alert('Please enter a valid name.');
            return;
        }

        if (renameType === 'group') {
            const group = state.groups.find(g => g.id === renameId);
            if (group) {
                group.name = newName;
                save();
                renderAll();
            }
        } else if (renameType === 'member') {
            const member = state.members.find(m => m.id === renameId);
            if (member) {
                member.name = newName;
                save();
                updateUIForActiveGroup();
            }
        }

        hideRenameModal();
    }

    // Modal event handlers
    renameCancel.addEventListener('click', hideRenameModal);
    renameConfirm.addEventListener('click', handleRename);
    renameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleRename();
        }
    });
    renameModal.addEventListener('click', (e) => {
        if (e.target === renameModal) {
            hideRenameModal();
        }
    });


    // CORE LOGIC: BALANCE & SETTLEMENTS
    function computeBalances(groupId) { // [cite: 17]
        const membersInGroup = getGroupMembers(groupId);
        if (membersInGroup.length === 0) return {};

        const bal = Object.fromEntries(membersInGroup.map(m => [m.id, 0])); // [cite: 17]

        for (const e of state.expenses.filter(x => x.groupId === groupId)) { // [cite: 18]
            const participants = e.split.participants;
            const shares = {};
            if (e.split.type === 'equal') { // [cite: 19]
                const share = +(e.amount / participants.length).toFixed(2);
                participants.forEach(p => shares[p] = share); // [cite: 20]
            } else if (e.split.type === 'exact') {
                Object.assign(shares, e.split.exact); // [cite: 20]
            } else { // percent
                participants.forEach(p => shares[p] = +(e.amount * (e.split.percent[p] / 100)).toFixed(2)); // [cite: 21]
            }
            if (bal[e.payerId] !== undefined) bal[e.payerId] += e.amount; // [cite: 22]
            for (const p of participants) {
                if (bal[p] !== undefined) bal[p] -= shares[p]; // [cite: 22]
            }
        }
        for (const k in bal) bal[k] = +bal[k].toFixed(2); // [cite: 23]
        return bal; // [cite: 24]
    }

    function suggestSettlements(balances) { // [cite: 26]
        const creditors = [], debtors = [];
        for (const [id, amt] of Object.entries(balances)) {
            if (amt > 0.01) creditors.push({ id, amt }); // [cite: 27]
            if (amt < -0.01) debtors.push({ id, amt: -amt }); // [cite: 28]
        }
        creditors.sort((a, b) => b.amt - a.amt);
        debtors.sort((a, b) => b.amt - a.amt);
        const tx = [];
        let i = 0, j = 0;
        while (i < creditors.length && j < debtors.length) { // [cite: 29]
            const give = Math.min(creditors[i].amt, debtors[j].amt); // [cite: 29]
            tx.push({ from: debtors[j].id, to: creditors[i].id, amount: +give.toFixed(2) }); // [cite: 30]
            creditors[i].amt -= give;
            debtors[j].amt -= give;
            if (creditors[i].amt < 0.01) i++; // [cite: 31]
            if (debtors[j].amt < 0.01) j++; // [cite: 32]
        }
        return tx;
    }

    // RENDER FUNCTIONS
    function renderAll() {
        renderGroups();
        const activeGroupExists = state.groups.some(g => g.id === activeGroupId);
        if (!activeGroupExists) {
            activeGroupId = state.groups[0]?.id || null;
        }
        updateUIForActiveGroup();
    }

    function renderGroups() {
        groupsList.innerHTML = '';
        state.groups.forEach(group => {
            const li = document.createElement('li');
            li.textContent = group.name;
            li.dataset.groupId = group.id;
            if (group.id === activeGroupId) li.classList.add('selected');

            // Add action buttons container
            const actionButtons = document.createElement('div');
            actionButtons.classList.add('action-buttons');

            // Add edit button
            const editButton = document.createElement('button');
            editButton.textContent = '✏️';
            editButton.classList.add('action-button', 'edit-button');
            editButton.title = 'Rename group';
            editButton.onclick = (e) => {
                e.stopPropagation();
                showRenameModal('group', group.id, group.name);
            };

            // Add delete button
            const deleteButton = document.createElement('button');
            deleteButton.textContent = '🗑️';
            deleteButton.classList.add('action-button', 'delete-button');
            deleteButton.title = 'Delete group';
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                console.log(`Attempting to delete group: ${group.name}`);
                if (confirm(`Are you sure you want to delete the group "${group.name}"? This will also delete all expenses in this group.`)) {
                    // Delete all expenses for this group
                    state.expenses = state.expenses.filter(expense => expense.groupId !== group.id);
                    state.groups = state.groups.filter(g => g.id !== group.id);
                    save();
                    renderAll();
                }
            };

            actionButtons.appendChild(editButton);
            actionButtons.appendChild(deleteButton);
            li.appendChild(actionButtons);
            groupsList.appendChild(li);
        });
    }

    function updateUIForActiveGroup() {
        if (!activeGroupId) {
            document.getElementById('members-section').style.display = 'none';
            document.getElementById('center-panel').style.display = 'none';
            document.getElementById('right-panel').style.display = 'none';
            return;
        }

        document.getElementById('members-section').style.display = 'block';
        document.getElementById('center-panel').style.display = 'flex';
        document.getElementById('right-panel').style.display = 'flex';

        const group = state.groups.find(g => g.id === activeGroupId);
        currentGroupName.textContent = group.name;
        addMemberButton.disabled = false;

        const members = getGroupMembers(activeGroupId);
        membersList.innerHTML = '';
        members.forEach(member => {
            const li = document.createElement('li');
            li.textContent = member.name;
            
            // Add action buttons container
            const actionButtons = document.createElement('div');
            actionButtons.classList.add('action-buttons');

            // Add edit button
            const editButton = document.createElement('button');
            editButton.textContent = '✏️';
            editButton.classList.add('action-button', 'edit-button');
            editButton.title = 'Rename member';
            editButton.onclick = (e) => {
                e.stopPropagation();
                showRenameModal('member', member.id, member.name);
            };

            // Add delete button
            const deleteButton = document.createElement('button');
            deleteButton.textContent = '🗑️';
            deleteButton.classList.add('action-button', 'delete-button');
            deleteButton.title = 'Delete member';
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete the member "${member.name}"? This will remove them from all expenses in this group.`)) {
                    // Remove member from group and state
                    const group = state.groups.find(g => g.id === activeGroupId);
                    group.memberIds = group.memberIds.filter(id => id !== member.id);
                    state.members = state.members.filter(m => m.id !== member.id);
                    
                    // Remove member from any expenses they participated in
                    state.expenses.forEach(expense => {
                        if (expense.groupId === activeGroupId) {
                            expense.split.participants = expense.split.participants.filter(id => id !== member.id);
                        }
                    });
                    
                    save();
                    updateUIForActiveGroup();
                }
            };

            actionButtons.appendChild(editButton);
            actionButtons.appendChild(deleteButton);
            li.appendChild(actionButtons);
            membersList.appendChild(li);
        });

        if (members.length > 0) {
            addExpenseButton.disabled = false;
            expensePayer.innerHTML = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            expenseParticipants.innerHTML = members.map(m => `<label><input type="checkbox" name="participants" value="${m.id}" checked> ${m.name}</label>`).join('');
        } else {
            addExpenseButton.disabled = true;
            expensePayer.innerHTML = '';
            expenseParticipants.innerHTML = 'Add members to create an expense.';
        }

        renderExpenses(activeGroupId);
        const balances = computeBalances(activeGroupId);
        renderBalances(balances);
        renderSettlements(suggestSettlements(balances));
    }

    function renderExpenses(groupId) {
        expensesList.innerHTML = '';
        const expenses = state.expenses.filter(e => e.groupId === groupId).sort((a, b) => b.createdAt - a.createdAt);
        if (expenses.length === 0) {
            expensesList.innerHTML = '<li>No expenses yet.</li>';
            return;
        }
        expenses.forEach(expense => {
            const li = document.createElement('li');
            li.innerHTML = `
        <div class="expense-details">
          <strong>${expense.description}</strong> ($${expense.amount.toFixed(2)})
          <small style="display: block; color: #666;">Paid by ${getMemberName(expense.payerId)}</small>
        </div>
        <div class="expense-actions">
          <button data-expense-id="${expense.id}" class="delete-expense">🗑️</button>
        </div>
      `;
            expensesList.appendChild(li);
        });
    }

    function renderBalances(balances) {
        balancesList.innerHTML = '';
        if (Object.keys(balances).length === 0) {
            balancesList.innerHTML = '<div>No balances to show.</div>';
            return;
        }
        for (const [id, amount] of Object.entries(balances)) {
            const div = document.createElement('div');
            const amountClass = amount >= 0 ? 'positive' : 'negative';
            div.innerHTML = `${getMemberName(id)}: <span class="${amountClass}">$${amount.toFixed(2)}</span>`;
            balancesList.appendChild(div);
        }
    }

    function renderSettlements(tx) {
        settlementsList.innerHTML = '';
        if (tx.length === 0) {
            settlementsList.innerHTML = '<div>All settled up! 🎉</div>';
            return;
        }
        tx.forEach(t => {
            const div = document.createElement('div');
            div.textContent = `${getMemberName(t.from)} → ${getMemberName(t.to)}: $${t.amount.toFixed(2)}`;
            settlementsList.appendChild(div);
        });
    }

    // EVENT HANDLERS
    addGroupForm.addEventListener('submit', e => {
        e.preventDefault();
        const name = groupNameInput.value.trim();
        if (name) {
            const newGroup = { id: `g${Date.now()}`, name, memberIds: [] };
            state.groups.push(newGroup);
            activeGroupId = newGroup.id;
            save();
            renderAll();
            groupNameInput.value = '';
        }
    });

    groupsList.addEventListener('click', e => {
        if (e.target.tagName === 'LI') {
            activeGroupId = e.target.dataset.groupId;
            renderGroups();
            updateUIForActiveGroup();
        }
    });

    addMemberForm.addEventListener('submit', e => {
        e.preventDefault();
        const name = memberNameInput.value.trim();
        if (!name || !activeGroupId) return;

        const membersInGroup = getGroupMembers(activeGroupId);
        if (membersInGroup.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            alert('Member name must be unique within the group.');
            return;
        }

        const newMember = { id: `u${Date.now()}`, name };
        state.members.push(newMember);
        const group = state.groups.find(g => g.id === activeGroupId);
        group.memberIds.push(newMember.id);
        save();
        updateUIForActiveGroup();
        memberNameInput.value = '';
    });

    // Handle split type changes
    document.querySelectorAll('input[name="split-type"]').forEach(radio => {
        radio.addEventListener('change', updateSplitInputs);
    });

    function updateSplitInputs() {
        const splitType = document.querySelector('input[name="split-type"]:checked').value;
        const participants = document.querySelectorAll('input[name="participants"]:checked');
        
        dynamicSplitInputs.innerHTML = '';
        
        if (splitType === 'exact') {
            const exactDiv = document.createElement('div');
            exactDiv.innerHTML = '<h4>Exact Amounts</h4>';
            
            participants.forEach(participant => {
                const memberId = participant.value;
                const memberName = getMemberName(memberId);
                
                const inputDiv = document.createElement('div');
                inputDiv.classList.add('form-control');
                inputDiv.innerHTML = `
                    <label for="exact-${memberId}">${memberName}'s Share ($)</label>
                    <input type="number" id="exact-${memberId}" class="exact-input" 
                           min="0.01" step="0.01" placeholder="0.00" required>
                `;
                exactDiv.appendChild(inputDiv);
            });
            
            dynamicSplitInputs.appendChild(exactDiv);
        } else if (splitType === 'percent') {
            const percentDiv = document.createElement('div');
            percentDiv.innerHTML = '<h4>Percentage Split</h4>';
            
            participants.forEach(participant => {
                const memberId = participant.value;
                const memberName = getMemberName(memberId);
                
                const inputDiv = document.createElement('div');
                inputDiv.classList.add('form-control');
                inputDiv.innerHTML = `
                    <label for="percent-${memberId}">${memberName}'s Percentage (%)</label>
                    <input type="number" id="percent-${memberId}" class="percent-input" 
                           min="0" max="100" step="1" placeholder="0" required>
                `;
                percentDiv.appendChild(inputDiv);
            });
            
            dynamicSplitInputs.appendChild(percentDiv);
        }
    }

    // Update split inputs when participants change
    expenseParticipants.addEventListener('change', updateSplitInputs);

    addExpenseForm.addEventListener('submit', e => {
        console.log("Adding expense...");
        e.preventDefault();
        const participantNodes = document.querySelectorAll('input[name="participants"]:checked');
        if (participantNodes.length === 0) {
            alert("Please select at least one participant.");
            return;
        }

        const description = expenseDescription.value.trim();
        const amount = parseFloat(expenseAmount.value);
        const payerId = expensePayer.value;
        const splitType = document.querySelector('input[name="split-type"]:checked').value;
        const participants = Array.from(participantNodes).map(node => node.value);

        const splitData = { type: splitType, participants };

        if (splitType === 'exact') {
            const exactAmounts = {};
            let totalExact = 0;
            
            participants.forEach(memberId => {
                const input = document.getElementById(`exact-${memberId}`);
                const amount = parseFloat(input.value) || 0;
                exactAmounts[memberId] = amount;
                totalExact += amount;
            });

            if (Math.abs(totalExact - amount) > 0.01) {
                alert(`Exact amounts must sum to $${amount.toFixed(2)}. Current total: $${totalExact.toFixed(2)}`);
                return;
            }

            splitData.exact = exactAmounts;
        } else if (splitType === 'percent') {
            const percentages = {};
            let totalPercent = 0;
            
            participants.forEach(memberId => {
                const input = document.getElementById(`percent-${memberId}`);
                const percent = parseFloat(input.value) || 0;
                percentages[memberId] = percent;
                totalPercent += percent;
            });

            if (Math.abs(totalPercent - 100) > 0.01) {
                alert(`Percentages must sum to 100%. Current total: ${totalPercent.toFixed(1)}%`);
                return;
            }

            splitData.percent = percentages;
        }

        const newExpense = {
            id: `e${Date.now()}`,
            groupId: activeGroupId,
            description,
            amount,
            payerId,
            split: splitData,
            createdAt: Date.now()
        };

        state.expenses.push(newExpense);
        save();
        addExpenseForm.reset();
        dynamicSplitInputs.innerHTML = '';
        updateUIForActiveGroup();
    });

    expensesList.addEventListener('click', e => {
        if (e.target.closest('.delete-expense')) {
            const expenseId = e.target.closest('.delete-expense').dataset.expenseId;
            state.expenses = state.expenses.filter(ex => ex.id !== expenseId);
            save();
            updateUIForActiveGroup();
        }
    });

    // INITIALIZATION
    function init() {
        if (state.groups.length === 0 && state.members.length === 0) { // [cite: 10]
            const m1 = { id: 'u1', name: 'Aditi' };
            const m2 = { id: 'u2', name: 'Ravi' };
            const g1 = { id: 'g1', name: 'Sample Trip', memberIds: ['u1', 'u2'] };
            state.members.push(m1, m2);
            state.groups.push(g1);
            save();
        }
        renderAll();
    }

    init();
});