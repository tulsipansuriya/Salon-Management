import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useLanguage } from './i18n/LanguageContext'
import { HomeScreen, JoinQueueScreen } from './screens/CustomerScreens'
import { MyStatusScreen } from './screens/MyStatusScreen'
import { ReceptionScreen } from './screens/ReceptionScreen'
import { BarberViewScreen } from './screens/BarberViewScreen'
import { WaitingAreaDisplay } from './screens/WaitingAreaDisplay'
import { AdminSettingsScreen } from './screens/AdminSettingsScreen'

function Header() {
  const { t, language, toggleLanguage } = useLanguage()
  const links = [
    ['/', 'home'], ['/join', 'join'], ['/reception', 'reception'],
    ['/barber/ravi', 'barber'], ['/display', 'display'], ['/admin', 'admin'],
  ] as const
  const location = useLocation()
  const isDisplay = location.pathname === '/display'
  if (isDisplay) return null
  return <header className="site-header">
    <Link className="brand" to="/">{t('salonName')}</Link>
    {!isDisplay && <button className="language-toggle" type="button" onClick={toggleLanguage} aria-label={t('language')}>{language === 'EN' ? 'GU' : 'EN'}</button>}
    <nav aria-label={t('staffNavigation')} className="screen-nav">
      {links.map(([path, key]) => <Link key={key} to={path} aria-current={location.pathname === path ? 'page' : undefined}>{t(key)}</Link>)}
    </nav>
  </header>
}

function App() {
  return <div className="app-shell min-h-screen bg-charcoal text-white"><Header /><Routes>
    <Route path="/" element={<HomeScreen />} />
    <Route path="/join" element={<JoinQueueScreen />} />
    <Route path="/status/:id" element={<MyStatusScreen />} />
    <Route path="/reception" element={<ReceptionScreen />} />
    <Route path="/barber/:name" element={<BarberViewScreen />} />
    <Route path="/display" element={<WaitingAreaDisplay />} />
    <Route path="/admin" element={<AdminSettingsScreen />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></div>
}

export default App
