document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const loginBtn = document.getElementById('nav-login-btn');
    if(loginBtn) {
        if(token) {
            loginBtn.innerText = 'Logout';
            loginBtn.href = '#';
            loginBtn.style.background = '#ef4444'; // Red for logout
            loginBtn.onclick = (e) => {
                e.preventDefault();
                localStorage.removeItem('token');
                window.location.reload();
            };
        } else {
            loginBtn.innerText = 'Sign In';
            loginBtn.href = 'login.html';
        }
    }
});
