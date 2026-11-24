import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useLanguage } from './i18n/LanguageContext'
import { HomeScreen, JoinQueueScreen } from './screens/CustomerScreens'

type ScreenProps = { titleKey: 'home' | 'join' | 'status' | 'reception' | 'barber' | 'display' | 'admin'; descriptionKey: 'homeDescription' | 'joinDescription' | 'statusDescription' | 'receptionDescription' | 'barberDescription' | 'displayDescription' | 'adminDescription' }

function Header() {
  const { t, language, toggleLanguage } = useLanguage()
  const links = [
    ['/', 'home'], ['/join', 'join'], ['/status/preview', 'status'], ['/reception', 'reception'],
    ['/barber/ravi', 'barber'], ['/display', 'display'], ['/admin', 'admin'],
  ] as const
  const location = useLocation()
  const isDisplay = location.pathname === '/display'
  return <header className="site-header">
    <Link className="brand" to="/">{t('salonName')}</Link>
    {!isDisplay && <button className="language-toggle" type="button" onClick={toggleLanguage} aria-label={t('language')}>{language === 'EN' ? 'GU' : 'EN'}</button>}
    <nav aria-label={t('staffNavigation')} className="screen-nav">
      {links.map(([path, key]) => <Link key={key} to={path} aria-current={location.pathname === path ? 'page' : undefined}>{t(key)}</Link>)}
    </nav>
  </header>
}

function Screen({ titleKey, descriptionKey }: ScreenProps) {
  const { t } = useLanguage()
  return <main className="screen-shell"><section className="screen-card">
    <p className="eyebrow">{t('salonName')}</p><h1>{t(titleKey)}</h1>
    <p className="screen-description">{t(descriptionKey)}</p>
    <span className="ready-badge">{t('routeReady')}</span>
  </section></main>
}

function App() {
  return <div className="app-shell min-h-screen bg-charcoal text-white"><Header /><Routes>
    <Route path="/" element={<HomeScreen />} />
    <Route path="/join" element={<JoinQueueScreen />} />
    <Route path="/status/:id" element={<Screen titleKey="status" descriptionKey="statusDescription" />} />
    <Route path="/reception" element={<Screen titleKey="reception" descriptionKey="receptionDescription" />} />
    <Route path="/barber/:name" element={<Screen titleKey="barber" descriptionKey="barberDescription" />} />
    <Route path="/display" element={<Screen titleKey="display" descriptionKey="displayDescription" />} />
    <Route path="/admin" element={<Screen titleKey="admin" descriptionKey="adminDescription" />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></div>
}

export default App
